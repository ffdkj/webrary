package com.webrary.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

@Service
@Slf4j
public class CalibreConverter {

    @Value("${webrary.calibre.path:ebook-convert}")
    private String calibrePath;

    /**
     * Convert a MOBI or AZW3 ebook file to EPUB format.
     * Output EPUB is placed in the same directory as the source file.
     * 
     * @param sourceFile path to the source ebook file
     * @return path to the converted EPUB file
     * @throws IOException if conversion fails or source file doesn't exist
     */
    public Path convertToEpub(Path sourceFile) throws IOException {
        if (!Files.exists(sourceFile)) {
            throw new IOException("Source file not found: " + sourceFile);
        }

        String filename = sourceFile.getFileName().toString().toLowerCase();
        if (filename.endsWith(".epub")) {
            log.info("File is already EPUB, skipping conversion: {}", sourceFile);
            return sourceFile;
        }

        if (!filename.endsWith(".mobi") && !filename.endsWith(".azw3")) {
            throw new IOException("Unsupported format for conversion: " + sourceFile +
                    ". Only MOBI and AZW3 are supported.");
        }

        // Build output path: same directory, .epub extension
        String baseName = sourceFile.getFileName().toString();
        int dotIndex = baseName.lastIndexOf('.');
        String epubName = baseName.substring(0, dotIndex) + ".epub";
        Path outputFile = sourceFile.resolveSibling(epubName);

        // Resolve the ebook-convert executable
        String converterExe = resolveConverterPath();

        // Run: ebook-convert "input.mobi" "output.epub"
        List<String> command = new ArrayList<>();
        command.add(converterExe);
        command.add(sourceFile.toAbsolutePath().toString());
        command.add(outputFile.toAbsolutePath().toString());

        log.info("Running Calibre conversion: {} -> {}", sourceFile.getFileName(), epubName);
        log.debug("Command: {}", String.join(" ", command));

        ProcessBuilder pb = new ProcessBuilder(command);
        pb.redirectErrorStream(true);

        Process process = pb.start();
        StringBuilder output = new StringBuilder();

        try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
            String line;
            while ((line = reader.readLine()) != null) {
                output.append(line).append("\n");
                log.debug("Calibre: {}", line);
            }
        }

        int exitCode;
        try {
            exitCode = process.waitFor();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("Conversion interrupted", e);
        }

        if (exitCode != 0) {
            throw new IOException("Calibre conversion failed with exit code " + exitCode +
                    ". Output: " + output.toString().trim());
        }

        if (!Files.exists(outputFile) || Files.size(outputFile) == 0) {
            throw new IOException("Conversion output file not found or empty: " + outputFile);
        }

        log.info("Calibre conversion complete: {} ({} bytes)", outputFile.getFileName(), Files.size(outputFile));
        return outputFile;
    }

    /**
     * Resolve the path to ebook-convert executable.
     * Searches common Windows installation paths if the configured path is not found.
     */
    private String resolveConverterPath() {
        // If the configured path already exists as a file, use it directly
        Path configuredPath = Path.of(calibrePath);
        if (Files.isExecutable(configuredPath) || calibrePath.endsWith(".exe")) {
            // Try directly
            try {
                ProcessBuilder pb = new ProcessBuilder(calibrePath, "--version");
                pb.redirectErrorStream(true);
                Process p = pb.start();
                int code = p.waitFor();
                if (code == 0) {
                    return calibrePath;
                }
            } catch (Exception ignored) {
            }
        }

        // Search common Windows paths
        List<String> searchPaths = new ArrayList<>();
        searchPaths.add("C:\\Program Files\\Calibre2\\ebook-convert.exe");
        searchPaths.add("C:\\Program Files (x86)\\Calibre2\\ebook-convert.exe");
        searchPaths.add("ebook-convert");
        searchPaths.add("ebook-convert.exe");

        for (String path : searchPaths) {
            try {
                ProcessBuilder pb = new ProcessBuilder(path, "--version");
                pb.redirectErrorStream(true);
                Process p = pb.start();
                int code = p.waitFor();
                if (code == 0) {
                    log.info("Found ebook-convert at: {}", path);
                    return path;
                }
            } catch (Exception ignored) {
            }
        }

        // Fallback to configured path — let it fail naturally if not found
        log.warn("Could not locate ebook-convert; using configured path: {}", calibrePath);
        return calibrePath;
    }
}
