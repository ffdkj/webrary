package com.webrary.service;

import com.webrary.dto.BookAddRequest;
import com.webrary.dto.EbookMetadata;
import com.webrary.dto.HistoryEntry;
import com.webrary.dto.ReadingProgressRequest;
import com.webrary.dto.ShelfBookResponse;
import com.webrary.model.Book;
import com.webrary.model.Bookshelf;
import com.webrary.model.ReadingProgress;
import com.webrary.model.ShelfBook;
import com.webrary.repository.BookRepository;
import com.webrary.repository.BookshelfRepository;
import com.webrary.repository.ReadingProgressRepository;
import com.webrary.repository.ShelfBookRepository;
import com.webrary.repository.ShelfBookRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class BookService {

    private final BookRepository bookRepository;
    private final BookshelfRepository bookshelfRepository;
    private final ShelfBookRepository shelfBookRepository;
    private final ReadingProgressRepository readingProgressRepository;
    private final EbookParserService ebookParserService;

    @Value("${webrary.upload-dir:./data/uploads}")
    private String uploadDir;

    /**
     * Get all books in a shelf with reading progress info.
     */
    public List<ShelfBookResponse> getBooksByShelf(Long shelfId) {
        Bookshelf shelf = bookshelfRepository.findById(shelfId)
                .orElseThrow(() -> new RuntimeException("Shelf not found: " + shelfId));

        List<ShelfBook> shelfBooks = shelfBookRepository.findByShelfOrderByAddedAtDesc(shelf);
        List<ShelfBookResponse> responses = new ArrayList<>();

        for (ShelfBook sb : shelfBooks) {
            Book book = sb.getBook();
            ReadingProgress progress = readingProgressRepository.findByBook(book).orElse(null);

            int unreadPages = 0;
            if (progress != null && progress.getTotalPages() > 0) {
                unreadPages = progress.getTotalPages() - progress.getCurrentPage();
            }

            responses.add(ShelfBookResponse.builder()
                    .id(sb.getId())
                    .bookId(book.getId())
                    .title(book.getTitle())
                    .author(book.getAuthor())
                    .coverUrl(book.getCoverUrl())
                    .extension(book.getExtension())
                    .filesize(book.getFilesize())
                    .unreadPages(unreadPages)
                    .isFinished(progress != null && progress.isFinished())
                    .filePath(book.getFilePath())
                    .zlibId(book.getZlibId())
                    .zlibHash(book.getZlibHash())
                    .build());
        }

        return responses;
    }

    /**
     * Add a book to a shelf. Creates the Book record if it doesn't exist by zlibId.
     */
    @Transactional
    public ShelfBook addBookToShelf(Long shelfId, BookAddRequest request) {
        Bookshelf shelf = bookshelfRepository.findById(shelfId)
                .orElseThrow(() -> new RuntimeException("Shelf not found: " + shelfId));

        Book book;
        if (request.getZlibId() != null) {
            Optional<Book> existing = bookRepository.findByZlibId(request.getZlibId());
            if (existing.isPresent()) {
                book = existing.get();
            } else {
                book = Book.builder()
                        .zlibId(request.getZlibId())
                        .zlibHash(request.getZlibHash() != null ? request.getZlibHash() : "")
                        .title(request.getTitle())
                        .author(request.getAuthor())
                        .coverUrl(request.getCoverUrl())
                        .extension(request.getExtension())
                        .filesize(request.getFilesize())
                        .description(request.getDescription())
                        .uploaded(false)
                        .build();
                book = bookRepository.save(book);
            }
        } else {
            book = Book.builder()
                    .title(request.getTitle())
                    .author(request.getAuthor())
                    .coverUrl(request.getCoverUrl())
                    .extension(request.getExtension())
                    .filesize(request.getFilesize())
                    .description(request.getDescription())
                    .uploaded(true)
                    .build();
            book = bookRepository.save(book);
        }

        // Check if already in this shelf
        if (shelfBookRepository.existsByShelfAndBook(shelf, book)) {
            return shelfBookRepository.findByShelfAndBook(shelf, book).orElse(null);
        }

        ShelfBook shelfBook = ShelfBook.builder()
                .shelf(shelf)
                .book(book)
                .build();

        return shelfBookRepository.save(shelfBook);
    }

    /**
     * Remove a book from a shelf (doesn't delete Book record).
     */
    @Transactional
    public void removeBookFromShelf(Long shelfId, Long bookId) {
        Bookshelf shelf = bookshelfRepository.findById(shelfId)
                .orElseThrow(() -> new RuntimeException("Shelf not found: " + shelfId));
        Book book = bookRepository.findById(bookId)
                .orElseThrow(() -> new RuntimeException("Book not found: " + bookId));

        shelfBookRepository.deleteByShelfAndBook(shelf, book);
    }

    /**
     * Transfer a book from one shelf to another.
     * If the book is already in the target shelf, just remove from source.
     */
    @Transactional
    public void transferBook(Long fromShelfId, Long toShelfId, Long bookId) {
        Bookshelf fromShelf = bookshelfRepository.findById(fromShelfId)
                .orElseThrow(() -> new RuntimeException("Source shelf not found: " + fromShelfId));
        Bookshelf toShelf = bookshelfRepository.findById(toShelfId)
                .orElseThrow(() -> new RuntimeException("Target shelf not found: " + toShelfId));
        Book book = bookRepository.findById(bookId)
                .orElseThrow(() -> new RuntimeException("Book not found: " + bookId));

        // Remove from source
        shelfBookRepository.deleteByShelfAndBook(fromShelf, book);

        // Add to target if not already there
        if (!shelfBookRepository.existsByShelfAndBook(toShelf, book)) {
            ShelfBook shelfBook = ShelfBook.builder()
                    .shelf(toShelf)
                    .book(book)
                    .build();
            shelfBookRepository.save(shelfBook);
        }
    }

    /**
     * Delete a book entirely from all shelves and the database.
     */
    @Transactional
    public void deleteBook(Long bookId) {
        Book book = bookRepository.findById(bookId)
                .orElseThrow(() -> new RuntimeException("Book not found: " + bookId));

        // Remove from all shelves
        List<ShelfBook> entries = shelfBookRepository.findByBook(book);
        shelfBookRepository.deleteAll(entries);

        // Remove reading progress
        readingProgressRepository.findByBook(book).ifPresent(readingProgressRepository::delete);

        // Delete uploaded file if exists
        if (book.isUploaded() && book.getFilePath() != null) {
            try {
                Files.deleteIfExists(Path.of(book.getFilePath()));
            } catch (IOException ignored) {
            }
        }

        bookRepository.delete(book);
    }

    /**
     * Upload a book file.
     */
    @Transactional
    public ShelfBook uploadBook(Long shelfId, MultipartFile file, String title, String author) throws IOException {
        Bookshelf shelf = bookshelfRepository.findById(shelfId)
                .orElseThrow(() -> new RuntimeException("Shelf not found: " + shelfId));

        // Ensure upload directory exists (use absolute path from working dir)
        Path uploadPath = Paths.get(uploadDir).toAbsolutePath().normalize();
        if (!Files.exists(uploadPath)) {
            Files.createDirectories(uploadPath);
        }

        // Generate unique filename
        String originalFilename = file.getOriginalFilename();
        String extension = "";
        if (originalFilename != null && originalFilename.contains(".")) {
            extension = originalFilename.substring(originalFilename.lastIndexOf("."));
        }
        String storedFilename = UUID.randomUUID().toString() + extension;
        Path filePath = uploadPath.resolve(storedFilename);

        // Save file
        file.transferTo(filePath.toFile());

        // Parse ebook metadata
        try {
            EbookMetadata meta = ebookParserService.parseFile(filePath, extension);
            if (meta.getTitle() != null && title == null) {
                title = meta.getTitle();
            }
            if (meta.getAuthor() != null && author == null) {
                author = meta.getAuthor();
            }
        } catch (Exception e) {
            log.warn("Failed to parse ebook: {}", e.getMessage());
        }

        // Create book record
        Book book = Book.builder()
                .title(title != null ? title : originalFilename)
                .author(author)
                .extension(extension.replace(".", ""))
                .filesize(file.getSize())
                .filePath(filePath.toString())
                .uploaded(true)
                .build();
        book = bookRepository.save(book);

        // Save cover image and update reading progress from parsed metadata
        try {
            EbookMetadata meta = ebookParserService.parseFile(filePath, extension);
            if (meta.getCoverBytes() != null && meta.getCoverBytes().length > 0) {
                String coverFilename = storedFilename.replace(extension, "_cover"
                        + (meta.getCoverFormat() != null ? "." + meta.getCoverFormat() : ".jpg"));
                Path coverPath = uploadPath.resolve(coverFilename);
                Files.write(coverPath, meta.getCoverBytes());
                book.setCoverUrl("/uploads/" + coverFilename);
                book = bookRepository.save(book);
            }
            if (meta.getPages() != null && meta.getPages() > 0) {
                ReadingProgress progress = readingProgressRepository.findByBook(book).orElse(null);
                if (progress == null) {
                    progress = ReadingProgress.builder().book(book).build();
                }
                progress.setTotalPages(meta.getPages());
                readingProgressRepository.save(progress);
            }
        } catch (Exception e) {
            log.warn("Failed to save parsed ebook metadata: {}", e.getMessage());
        }

        // Add to shelf
        ShelfBook shelfBook = ShelfBook.builder()
                .shelf(shelf)
                .book(book)
                .build();

        return shelfBookRepository.save(shelfBook);
    }

    /**
     * Get reading progress for a book (creates default if not found).
     */
    public ReadingProgress getReadingProgress(Long bookId) {
        Book book = bookRepository.findById(bookId)
                .orElseThrow(() -> new RuntimeException("Book not found: " + bookId));
        return readingProgressRepository.findByBook(book)
                .orElseGet(() -> {
                    ReadingProgress progress = ReadingProgress.builder()
                            .book(book)
                            .currentPage(0)
                            .totalPages(0)
                            .finished(false)
                            .build();
                    return readingProgressRepository.save(progress);
                });
    }

    /**
     * Update reading progress for a book.
     */
    @Transactional
    public ReadingProgress updateReadingProgress(Long bookId, ReadingProgressRequest request) {
        Book book = bookRepository.findById(bookId)
                .orElseThrow(() -> new RuntimeException("Book not found: " + bookId));

        ReadingProgress progress = readingProgressRepository.findByBook(book)
                .orElseGet(() -> ReadingProgress.builder()
                        .book(book)
                        .currentPage(0)
                        .totalPages(0)
                        .finished(false)
                        .build());

        progress.setCurrentPage(request.getCurrentPage());
        if (request.getTotalPages() > 0) {
            progress.setTotalPages(request.getTotalPages());
        }
        progress.setFinished(request.isFinished());
        progress.setLastReadAt(LocalDateTime.now());

        return readingProgressRepository.save(progress);
    }

    /**
     * Get reading history — all books that have been read, ordered by most recent first.
     */
    public List<HistoryEntry> getReadingHistory() {
        List<ReadingProgress> progresses = readingProgressRepository.findByLastReadAtIsNotNullOrderByLastReadAtDesc();
        List<HistoryEntry> entries = new ArrayList<>();
        for (ReadingProgress p : progresses) {
            Book b = p.getBook();
            entries.add(HistoryEntry.builder()
                    .bookId(b.getId())
                    .title(b.getTitle())
                    .author(b.getAuthor())
                    .coverUrl(b.getCoverUrl())
                    .extension(b.getExtension())
                    .lastReadAt(p.getLastReadAt())
                    .build());
        }
        return entries;
    }
}
