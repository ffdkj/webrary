package com.webrary.repository;

import com.webrary.model.Book;
import com.webrary.model.Bookshelf;
import com.webrary.model.ShelfBook;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import java.util.List;
import java.util.Optional;

public interface ShelfBookRepository extends JpaRepository<ShelfBook, Long> {
    List<ShelfBook> findByShelfOrderByAddedAtDesc(Bookshelf shelf);
    Optional<ShelfBook> findByShelfAndBook(Bookshelf shelf, Book book);
    boolean existsByShelfAndBook(Bookshelf shelf, Book book);

    @Modifying
    @Query("DELETE FROM ShelfBook sb WHERE sb.shelf = :shelf AND sb.book = :book")
    void deleteByShelfAndBook(Bookshelf shelf, Book book);

    List<ShelfBook> findByBook(Book book);
}
