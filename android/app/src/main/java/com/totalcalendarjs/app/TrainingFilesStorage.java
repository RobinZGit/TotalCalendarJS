package com.totalcalendarjs.app;

import android.content.Context;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/** Тихое сохранение чекпоинтов тренировки (.rtm, пульс) без системного диалога. */
public final class TrainingFilesStorage {
    private static final String DIRECTORY_NAME = "training-checkpoints";

    private TrainingFilesStorage() {
    }

    public static File getCheckpointsDirectory(Context context) {
        File base = context.getExternalFilesDir(null);
        if (base == null) {
            base = context.getFilesDir();
        }
        File directory = new File(base, DIRECTORY_NAME);
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IllegalStateException("Cannot create checkpoints directory");
        }
        return directory;
    }

    public static int deleteAllCheckpoints(Context context) {
        File directory = getCheckpointsDirectory(context);
        File[] files = directory.listFiles();
        int deleted = 0;
        if (files != null) {
            for (File file : files) {
                if (file.isFile() && file.delete()) {
                    deleted++;
                }
            }
        }
        return deleted;
    }

    public static File saveText(Context context, String text, String filename) throws IOException {
        String safeName = sanitizeFilename(filename);
        File file = new File(getCheckpointsDirectory(context), safeName);
        byte[] bytes = text == null ? new byte[0] : text.getBytes(StandardCharsets.UTF_8);
        try (FileOutputStream outputStream = new FileOutputStream(file)) {
            outputStream.write(bytes);
        }
        return file;
    }

    private static String sanitizeFilename(String filename) {
        if (filename == null || filename.trim().isEmpty()) {
            return "TotalCalendar.txt";
        }
        return filename.replaceAll("[\\\\/:*?\"<>|]", "_");
    }
}
