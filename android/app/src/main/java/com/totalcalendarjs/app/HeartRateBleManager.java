package com.totalcalendarjs.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.util.Log;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * BLE Heart Rate (GATT 0x180D / 0x2A37). Scan, pick device, subscribe to notifications.
 */
public final class HeartRateBleManager {
    private static final String TAG = "HeartRateBle";

    public static final UUID UUID_HEART_RATE_SERVICE =
            UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb");
    private static final UUID UUID_HEART_RATE_MEASUREMENT =
            UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb");
    private static final UUID UUID_CLIENT_CHARACTERISTIC_CONFIG =
            UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    private static final long SCAN_DURATION_MS = 8000L;
    private static final int MAX_DEVICES = 40;

    public interface Listener {
        void onHeartRateBpm(int bpm);

        void onSensorDisconnected();
    }

    private final Activity activity;
    private final Listener listener;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private BluetoothAdapter bluetoothAdapter;
    private BluetoothLeScanner scanner;
    private BluetoothGatt gatt;

    private final Map<String, BluetoothDevice> scanDevices = new LinkedHashMap<>();
    private final Runnable stopScanRunnable = this::endScanAndPickDevice;
    private final ScanCallback scanCallback = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            if (result == null || result.getDevice() == null) {
                return;
            }
            BluetoothDevice device = result.getDevice();
            String key = device.getAddress();
            if (key == null) {
                return;
            }
            synchronized (scanDevices) {
                if (scanDevices.size() >= MAX_DEVICES && !scanDevices.containsKey(key)) {
                    return;
                }
                scanDevices.put(key, device);
            }
        }
    };

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
            if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                mainHandler.post(() -> {
                    closeGatt();
                    listener.onSensorDisconnected();
                });
            } else if (newState == BluetoothProfile.STATE_CONNECTED) {
                mainHandler.post(() -> g.discoverServices());
            }
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt g, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                mainHandler.post(() -> disconnect());
                return;
            }
            BluetoothGattService hr = g.getService(UUID_HEART_RATE_SERVICE);
            if (hr == null) {
                Log.w(TAG, "Heart Rate service not found");
                mainHandler.post(() -> disconnect());
                return;
            }
            BluetoothGattCharacteristic chr = hr.getCharacteristic(UUID_HEART_RATE_MEASUREMENT);
            if (chr == null) {
                mainHandler.post(() -> disconnect());
                return;
            }
            boolean notifyOk = g.setCharacteristicNotification(chr, true);
            if (!notifyOk) {
                mainHandler.post(() -> disconnect());
                return;
            }
            BluetoothGattDescriptor cccd = chr.getDescriptor(UUID_CLIENT_CHARACTERISTIC_CONFIG);
            if (cccd == null) {
                mainHandler.post(() -> disconnect());
                return;
            }
            cccd.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
            g.writeDescriptor(cccd);
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic characteristic) {
            if (!UUID_HEART_RATE_MEASUREMENT.equals(characteristic.getUuid())) {
                return;
            }
            int bpm = parseHeartRateMeasurement(characteristic.getValue());
            if (bpm > 0) {
                mainHandler.post(() -> listener.onHeartRateBpm(bpm));
            }
        }
    };

    public HeartRateBleManager(Activity activity, Listener listener) {
        this.activity = activity;
        this.listener = listener;
    }

    private static int parseHeartRateMeasurement(byte[] value) {
        if (value == null || value.length < 2) {
            return -1;
        }
        int flags = value[0] & 0xff;
        int offset = 1;
        int bpm;
        if ((flags & 0x01) != 0) {
            if (value.length < offset + 2) {
                return -1;
            }
            bpm = (value[offset + 1] & 0xff) << 8 | (value[offset] & 0xff);
            offset += 2;
        } else {
            bpm = value[offset] & 0xff;
            offset += 1;
        }
        if (bpm <= 0 || bpm > 250) {
            return -1;
        }
        return bpm;
    }

    @SuppressLint("MissingPermission")
    public void startScanAndPickDevice() {
        BluetoothManager manager = (BluetoothManager) activity.getSystemService(Context.BLUETOOTH_SERVICE);
        if (manager == null) {
            toast("Bluetooth недоступен");
            return;
        }
        bluetoothAdapter = manager.getAdapter();
        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
            toast("Включите Bluetooth");
            return;
        }
        disconnect();
        scanner = bluetoothAdapter.getBluetoothLeScanner();
        if (scanner == null) {
            toast("Сканер BLE недоступен");
            return;
        }
        synchronized (scanDevices) {
            scanDevices.clear();
        }
        ScanSettings settings = new ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .build();
        android.bluetooth.le.ScanFilter filter = new ScanFilter.Builder()
                .setServiceUuid(new ParcelUuid(UUID_HEART_RATE_SERVICE))
                .build();
        try {
            scanner.startScan(java.util.Collections.singletonList(filter), settings, scanCallback);
        } catch (Exception e) {
            Log.e(TAG, "startScan failed", e);
            toast("Не удалось начать поиск: " + e.getMessage());
            return;
        }
        mainHandler.postDelayed(stopScanRunnable, SCAN_DURATION_MS);
    }

    @SuppressLint("MissingPermission")
    private void stopScanOnly() {
        mainHandler.removeCallbacks(stopScanRunnable);
        if (scanner != null) {
            try {
                scanner.stopScan(scanCallback);
            } catch (Exception ignored) {
            }
            scanner = null;
        }
    }

    private void endScanAndPickDevice() {
        stopScanOnly();
        synchronized (scanDevices) {
            if (scanDevices.isEmpty()) {
                toast("Пульсометры BLE не найдены. Включите датчик и повторите.");
                return;
            }
            List<BluetoothDevice> list = new ArrayList<>(scanDevices.values());
            String[] labels = new String[list.size()];
            for (int i = 0; i < list.size(); i++) {
                BluetoothDevice d = list.get(i);
                String name = d.getName();
                labels[i] = (name != null && !name.isEmpty() ? name : "Без имени") + "\n" + d.getAddress();
            }
            new AlertDialog.Builder(activity)
                    .setTitle("Выберите пульсометр")
                    .setItems(labels, (dialog, which) -> connect(list.get(which)))
                    .setNegativeButton(android.R.string.cancel, null)
                    .show();
        }
    }

    @SuppressLint("MissingPermission")
    private void connect(BluetoothDevice device) {
        stopScanOnly();
        closeGatt();
        gatt = device.connectGatt(activity, false, gattCallback, BluetoothDevice.TRANSPORT_LE);
        if (gatt == null) {
            toast("Не удалось подключиться");
        }
    }

    @SuppressLint("MissingPermission")
    public void disconnect() {
        stopScanOnly();
        if (gatt != null) {
            try {
                gatt.disconnect();
            } catch (Exception ignored) {
            }
            try {
                gatt.close();
            } catch (Exception ignored) {
            }
            gatt = null;
        }
        listener.onSensorDisconnected();
    }

    private void closeGatt() {
        if (gatt != null) {
            try {
                gatt.close();
            } catch (Exception ignored) {
            }
            gatt = null;
        }
    }

    private void toast(String message) {
        mainHandler.post(() ->
                android.widget.Toast.makeText(activity, message, android.widget.Toast.LENGTH_LONG).show());
    }

    public void destroy() {
        mainHandler.removeCallbacks(stopScanRunnable);
        disconnect();
    }
}
