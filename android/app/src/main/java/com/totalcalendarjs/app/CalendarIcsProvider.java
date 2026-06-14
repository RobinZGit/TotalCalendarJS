package com.totalcalendarjs.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.FileNotFoundException;

public final class CalendarIcsProvider extends ContentProvider {
    private static final String CACHE_DIRECTORY = "calendar-imports";

    static String authorityFor(Context context) {
        return context.getPackageName() + ".calendarics";
    }

    public static File getCalendarCacheDirectory(Context context) {
        File directory = new File(context.getCacheDir(), CACHE_DIRECTORY);
        if (!directory.exists()) {
            directory.mkdirs();
        }
        return directory;
    }

    public static Uri getUriForFile(Context context, File file) {
        return new Uri.Builder()
                .scheme("content")
                .authority(authorityFor(context))
                .appendPath(file.getName())
                .build();
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public String getType(Uri uri) {
        return "text/calendar";
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) {
            throw new FileNotFoundException("Only read access is supported");
        }

        Context context = getContext();
        if (context == null) {
            throw new FileNotFoundException("Context is unavailable");
        }

        String filename = uri.getLastPathSegment();
        if (filename == null || filename.contains("/") || filename.contains("\\")) {
            throw new FileNotFoundException("Invalid file name");
        }

        File file = new File(getCalendarCacheDirectory(context), filename);
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        return null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
