package com.webrary.controller;

import com.webrary.dto.*;
import com.webrary.model.Book;
import com.webrary.model.ReadingProgress;
import com.webrary.model.ShelfBook;
import com.webrary.repository.BookRepository;
import com.webrary.service.BookService;
import com.webrary.service.CalibreConverter;
import com.webrary.service.EbookParserService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.rendering.PDFRenderer;

@RestController
@RequestMapping("/api/books")
@RequiredArgsConstructor
public class BookController {

    private final BookService bookService;
    private final EbookParserService ebookParserService;
    private final BookRepository bookRepository;
    private final CalibreConverter calibreConverter;

    @GetMapping("/shelf/{shelfId}")
    public ApiResponse<List<ShelfBookResponse>> getBooksByShelf(@PathVariable Long shelfId) {
        return ApiResponse.success(bookService.getBooksByShelf(shelfId));
    }

    @PostMapping("/shelf/{shelfId}")
    public ApiResponse<ShelfBookResponse> addBookToShelf(@PathVariable Long shelfId,
                                                          @RequestBody BookAddRequest request) {
        ShelfBook sb = bookService.addBookToShelf(shelfId, request);
        ReadingProgress progress = bookService.getReadingProgress(sb.getBook().getId());

        int unreadPages = 0;
        if (progress.getTotalPages() > 0) {
            unreadPages = progress.getTotalPages() - progress.getCurrentPage();
        }

        ShelfBookResponse response = ShelfBookResponse.builder()
                .id(sb.getId())
                .bookId(sb.getBook().getId())
                .title(sb.getBook().getTitle())
                .author(sb.getBook().getAuthor())
                .coverUrl(sb.getBook().getCoverUrl())
                .extension(sb.getBook().getExtension())
                .filesize(sb.getBook().getFilesize())
                .unreadPages(unreadPages)
                .isFinished(progress.isFinished())
                .build();

        return ApiResponse.success(response);
    }

    @DeleteMapping("/shelf/{shelfId}/book/{bookId}")
    public ApiResponse<Void> removeFromShelf(@PathVariable Long shelfId, @PathVariable Long bookId) {
        bookService.removeBookFromShelf(shelfId, bookId);
        return ApiResponse.success("Book removed from shelf", null);
    }

    @PostMapping("/transfer")
    public ApiResponse<Void> transferBook(@RequestBody TransferRequest request) {
        bookService.transferBook(request.getFromShelfId(), request.getToShelfId(), request.getBookId());
        return ApiResponse.success("Book transferred", null);
    }

    @DeleteMapping("/{bookId}")
    public ApiResponse<Void> deleteBook(@PathVariable Long bookId) {
        bookService.deleteBook(bookId);
        return ApiResponse.success("Book deleted", null);
    }

    @GetMapping("/{bookId}")
    public ApiResponse<ShelfBookResponse> getBookById(@PathVariable Long bookId) {
        Book book = bookRepository.findById(bookId)
                .orElseThrow(() -> new RuntimeException("Book not found: " + bookId));
        ShelfBookResponse response = ShelfBookResponse.builder()
                .bookId(book.getId())
                .title(book.getTitle())
                .author(book.getAuthor())
                .coverUrl(book.getCoverUrl())
                .extension(book.getExtension())
                .filesize(book.getFilesize())
                .filePath(book.getFilePath())
                .zlibId(book.getZlibId())
                .zlibHash(book.getZlibHash())
                .build();
        return ApiResponse.success(response);
    }

    @GetMapping("/{bookId}/progress")
    public ApiResponse<ReadingProgress> getReadingProgress(@PathVariable Long bookId) {
        return ApiResponse.success(bookService.getReadingProgress(bookId));
    }

    @PutMapping("/{bookId}/progress")
    public ApiResponse<ReadingProgress> updateReadingProgress(@PathVariable Long bookId,
                                                               @RequestBody ReadingProgressRequest request) {
        return ApiResponse.success(bookService.updateReadingProgress(bookId, request));
    }

    @PostMapping("/upload")
    public ApiResponse<ShelfBookResponse> uploadBook(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "title", required = false) String title,
            @RequestParam(value = "author", required = false) String author,
            @RequestParam("shelfId") Long shelfId) throws Exception {

        ShelfBook sb = bookService.uploadBook(shelfId, file, title, author);
        ReadingProgress progress = bookService.getReadingProgress(sb.getBook().getId());

        int unreadPages = 0;
        if (progress.getTotalPages() > 0) {
            unreadPages = progress.getTotalPages() - progress.getCurrentPage();
        }

        ShelfBookResponse response = ShelfBookResponse.builder()
                .id(sb.getId())
                .bookId(sb.getBook().getId())
                .title(sb.getBook().getTitle())
                .author(sb.getBook().getAuthor())
                .coverUrl(sb.getBook().getCoverUrl())
                .extension(sb.getBook().getExtension())
                .filesize(sb.getBook().getFilesize())
                .unreadPages(unreadPages)
                .isFinished(progress.isFinished())
                .build();

        return ApiResponse.success(response);
    }

    @GetMapping("/{bookId}/toc")
    public ApiResponse<List<TocEntry>> getTableOfContents(@PathVariable Long bookId) {
        Book book = bookRepository.findById(bookId)
                .orElseThrow(() -> new RuntimeException("Book not found: " + bookId));

        if (book.getFilePath() == null) {
            return ApiResponse.success(Collections.emptyList());
        }

        Path filePath = Path.of(book.getFilePath());
        if (!filePath.toFile().exists()) {
            return ApiResponse.success(Collections.emptyList());
        }

        try {
            String extension = book.getExtension() != null ? "." + book.getExtension() : "";
            EbookMetadata meta = ebookParserService.parseFile(filePath, extension);
            return ApiResponse.success(meta.getToc() != null ? meta.getToc() : Collections.emptyList());
        } catch (Exception e) {
            return ApiResponse.success(Collections.emptyList());
        }
    }

    /** Serve uploaded/downloaded book files for reading */
    @GetMapping("/{bookId}/read")
    public ResponseEntity<?> readBook(@PathVariable Long bookId) {
        Book book = bookRepository.findById(bookId)
                .orElseThrow(() -> new RuntimeException("Book not found: " + bookId));

        if (book.getFilePath() == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ApiResponse.error("No file available for this book"));
        }

        Path filePath = Path.of(book.getFilePath());
        if (!filePath.toFile().exists()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ApiResponse.error("File not found on disk"));
        }

        try {
            byte[] bytes = Files.readAllBytes(filePath);
            String contentType = "application/octet-stream";
            if (book.getExtension() != null) {
                contentType = switch (book.getExtension().toLowerCase()) {
                    case "pdf" -> "application/pdf";
                    case "epub" -> "application/epub+zip";
                    case "mobi" -> "application/x-mobipocket-ebook";
                    case "txt" -> "text/plain;charset=UTF-8";
                    default -> "application/octet-stream";
                };
            }

            return ResponseEntity.ok()
                    .contentType(org.springframework.http.MediaType.parseMediaType(contentType))
                    .body(bytes);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(ApiResponse.error("Read failed: " + e.getMessage()));
        }
    }

    /** Stream book file inline for the foliate-js reader (not as download attachment) */
    @GetMapping("/{bookId}/stream")
    public ResponseEntity<?> streamBook(@PathVariable Long bookId) {
        Book book = bookRepository.findById(bookId)
                .orElseThrow(() -> new RuntimeException("Book not found: " + bookId));

        if (book.getFilePath() == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ApiResponse.error("No file available for this book"));
        }

        Path filePath = Path.of(book.getFilePath());
        if (!filePath.toFile().exists()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ApiResponse.error("File not found on disk"));
        }

        try {
            byte[] bytes = Files.readAllBytes(filePath);
            String contentType = "application/octet-stream";
            String filename = filePath.getFileName().toString();
            if (book.getExtension() != null) {
                contentType = switch (book.getExtension().toLowerCase()) {
                    case "pdf" -> "application/pdf";
                    case "epub" -> "application/epub+zip";
                    case "mobi" -> "application/x-mobipocket-ebook";
                    case "txt" -> "text/plain;charset=UTF-8";
                    default -> "application/octet-stream";
                };
            }

            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + filename + "\"")
                    .contentType(MediaType.parseMediaType(contentType))
                    .body(bytes);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(ApiResponse.error("Stream failed: " + e.getMessage()));
        }
    }

    /** Convert MOBI/AZW3 book to EPUB using Calibre */
    @PostMapping("/{bookId}/convert")
    public ApiResponse<ShelfBookResponse> convertBook(@PathVariable Long bookId) {
        Book book = bookRepository.findById(bookId)
                .orElseThrow(() -> new RuntimeException("Book not found: " + bookId));

        String ext = book.getExtension();
        if (ext == null || (!ext.equalsIgnoreCase("mobi") && !ext.equalsIgnoreCase("azw3"))) {
            return ApiResponse.error("Book is not in MOBI or AZW3 format (current: " + ext + ")");
        }

        if (book.getFilePath() == null || !Path.of(book.getFilePath()).toFile().exists()) {
            return ApiResponse.error("Book file not found on disk");
        }

        try {
            Path convertedPath = calibreConverter.convertToEpub(Path.of(book.getFilePath()));
            book.setFilePath(convertedPath.toString());
            book.setExtension("epub");
            bookRepository.save(book);

            ShelfBookResponse response = ShelfBookResponse.builder()
                    .bookId(book.getId())
                    .title(book.getTitle())
                    .author(book.getAuthor())
                    .coverUrl(book.getCoverUrl())
                    .extension(book.getExtension())
                    .filesize(book.getFilesize())
                    .filePath(book.getFilePath())
                    .zlibId(book.getZlibId())
                    .zlibHash(book.getZlibHash())
                    .build();

            return ApiResponse.success("Converted to EPUB", response);
        } catch (Exception e) {
            return ApiResponse.error("Conversion failed: " + e.getMessage());
        }
    }

    /** PDF metadata endpoint — returns page count and document info */
    @GetMapping("/{bookId}/pdf/info")
    public ApiResponse<Map<String, Object>> getPdfInfo(@PathVariable Long bookId) {
        Book book = bookRepository.findById(bookId)
                .orElseThrow(() -> new RuntimeException("Book not found: " + bookId));
        if (book.getFilePath() == null || !book.getFilePath().toLowerCase().endsWith(".pdf")) {
            return ApiResponse.error("Not a PDF file");
        }
        Path filePath = Path.of(book.getFilePath());
        if (!filePath.toFile().exists()) {
            return ApiResponse.error("File not found");
        }
        try (PDDocument doc = Loader.loadPDF(filePath.toFile())) {
            Map<String, Object> info = new HashMap<>();
            info.put("totalPages", doc.getNumberOfPages());
            if (doc.getDocumentInformation() != null) {
                info.put("title", doc.getDocumentInformation().getTitle());
                info.put("author", doc.getDocumentInformation().getAuthor());
            }
            return ApiResponse.success(info);
        } catch (Exception e) {
            return ApiResponse.error("Failed: " + e.getMessage());
        }
    }

    /** Render a single PDF page as PNG */
    @GetMapping("/{bookId}/pdf/page/{pageNum}")
    public ResponseEntity<?> getPdfPage(@PathVariable Long bookId,
                                         @PathVariable int pageNum,
                                         @RequestParam(defaultValue = "144") int dpi) {
        Book book = bookRepository.findById(bookId)
                .orElseThrow(() -> new RuntimeException("Book not found: " + bookId));
        if (book.getFilePath() == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body("No file");
        }
        Path filePath = Path.of(book.getFilePath());
        try (PDDocument doc = Loader.loadPDF(filePath.toFile())) {
            if (pageNum < 1 || pageNum > doc.getNumberOfPages()) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body("Page out of range");
            }
            PDFRenderer renderer = new PDFRenderer(doc);
            BufferedImage image = renderer.renderImageWithDPI(pageNum - 1, dpi);
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            ImageIO.write(image, "PNG", baos);
            byte[] bytes = baos.toByteArray();
            return ResponseEntity.ok()
                    .contentType(MediaType.IMAGE_PNG)
                    .header(HttpHeaders.CACHE_CONTROL, "max-age=" + (pageNum <= 10 ? 86400 : 3600))
                    .body(bytes);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body("Render failed: " + e.getMessage());
        }
    }
}
