package com.webrary.controller;

import com.webrary.dto.ApiResponse;
import com.webrary.dto.BookshelfRequest;
import com.webrary.dto.ReorderRequest;
import com.webrary.dto.ShelfStats;
import com.webrary.model.Bookshelf;
import com.webrary.service.BookshelfService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/bookshelves")
@RequiredArgsConstructor
public class BookshelfController {

    private final BookshelfService bookshelfService;

    @GetMapping
    public ApiResponse<List<Bookshelf>> listAll() {
        return ApiResponse.success(bookshelfService.listAll());
    }

    @PostMapping
    public ApiResponse<Bookshelf> create(@RequestBody BookshelfRequest request) {
        return ApiResponse.success(bookshelfService.create(request.getName()));
    }

    @PutMapping("/{id}")
    public ApiResponse<Bookshelf> update(@PathVariable Long id, @RequestBody BookshelfRequest request) {
        return ApiResponse.success(bookshelfService.update(id, request.getName()));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        bookshelfService.delete(id);
        return ApiResponse.success("Shelf deleted", null);
    }

    @PostMapping("/reorder")
    public ApiResponse<Void> reorder(@RequestBody ReorderRequest request) {
        bookshelfService.reorder(request.getShelfIds());
        return ApiResponse.success("Reordered", null);
    }

    @GetMapping("/{id}/stats")
    public ApiResponse<ShelfStats> getStats(@PathVariable Long id) {
        return ApiResponse.success(bookshelfService.getStats(id));
    }
}
