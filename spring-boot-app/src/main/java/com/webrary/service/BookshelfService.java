package com.webrary.service;

import com.webrary.dto.ShelfStats;
import com.webrary.model.Bookshelf;
import com.webrary.model.ReadingProgress;
import com.webrary.model.ShelfBook;
import com.webrary.repository.BookshelfRepository;
import com.webrary.repository.ReadingProgressRepository;
import com.webrary.repository.ShelfBookRepository;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
public class BookshelfService {

    private final BookshelfRepository bookshelfRepository;
    private final ShelfBookRepository shelfBookRepository;
    private final ReadingProgressRepository readingProgressRepository;

    @PostConstruct
    public void init() {
        // Create default shelf if none exist
        if (bookshelfRepository.count() == 0) {
            Bookshelf defaultShelf = Bookshelf.builder()
                    .name("默认书架")
                    .sortOrder(0)
                    .build();
            bookshelfRepository.save(defaultShelf);
        }
    }

    public List<Bookshelf> listAll() {
        return bookshelfRepository.findAllByOrderBySortOrderAsc();
    }

    @Transactional
    public Bookshelf create(String name) {
        int maxOrder = bookshelfRepository.findAllByOrderBySortOrderAsc()
                .stream()
                .mapToInt(Bookshelf::getSortOrder)
                .max()
                .orElse(0);

        Bookshelf shelf = Bookshelf.builder()
                .name(name)
                .sortOrder(maxOrder + 1)
                .build();
        return bookshelfRepository.save(shelf);
    }

    @Transactional
    public Bookshelf update(Long id, String name) {
        Bookshelf shelf = bookshelfRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Shelf not found: " + id));
        shelf.setName(name);
        return bookshelfRepository.save(shelf);
    }

    @Transactional
    public void delete(Long id) {
        Bookshelf shelf = bookshelfRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Shelf not found: " + id));

        // Remove all ShelfBook entries for this shelf (doesn't delete Book records)
        List<ShelfBook> shelfBooks = shelfBookRepository.findByShelfOrderByAddedAtDesc(shelf);
        shelfBookRepository.deleteAll(shelfBooks);

        bookshelfRepository.delete(shelf);
    }

    @Transactional
    public void reorder(List<Long> shelfIds) {
        for (int i = 0; i < shelfIds.size(); i++) {
            final int sortOrder = i;
            final Long shelfId = shelfIds.get(i);
            Bookshelf shelf = bookshelfRepository.findById(shelfId)
                    .orElseThrow(() -> new RuntimeException("Shelf not found: " + shelfId));
            shelf.setSortOrder(sortOrder);
            bookshelfRepository.save(shelf);
        }
    }

    public ShelfStats getStats(Long shelfId) {
        Bookshelf shelf = bookshelfRepository.findById(shelfId)
                .orElseThrow(() -> new RuntimeException("Shelf not found: " + shelfId));

        List<ShelfBook> shelfBooks = shelfBookRepository.findByShelfOrderByAddedAtDesc(shelf);

        int bookCount = shelfBooks.size();
        int finishedCount = 0;
        int unreadCount = 0;

        for (ShelfBook sb : shelfBooks) {
            ReadingProgress progress = readingProgressRepository.findByBook(sb.getBook()).orElse(null);
            if (progress != null && progress.isFinished()) {
                finishedCount++;
            } else if (progress == null || progress.getCurrentPage() == 0) {
                unreadCount++;
            }
        }

        return ShelfStats.builder()
                .bookCount(bookCount)
                .unreadCount(unreadCount)
                .finishedCount(finishedCount)
                .build();
    }
}
