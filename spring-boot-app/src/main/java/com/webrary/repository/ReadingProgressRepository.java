package com.webrary.repository;

import com.webrary.model.Book;
import com.webrary.model.ReadingProgress;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

public interface ReadingProgressRepository extends JpaRepository<ReadingProgress, Long> {
    Optional<ReadingProgress> findByBook(Book book);
}
