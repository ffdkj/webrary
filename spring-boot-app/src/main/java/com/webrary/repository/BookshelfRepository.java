package com.webrary.repository;

import com.webrary.model.Bookshelf;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface BookshelfRepository extends JpaRepository<Bookshelf, Long> {
    List<Bookshelf> findAllByOrderBySortOrderAsc();
}
