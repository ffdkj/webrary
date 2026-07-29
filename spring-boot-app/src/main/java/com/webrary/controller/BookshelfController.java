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

/**
 * 书架控制器 — 管理用户书架的增删改查、排序和统计。
 */
@RestController
@RequestMapping("/api/bookshelves")
@RequiredArgsConstructor
public class BookshelfController {

    private final BookshelfService bookshelfService;

    /**
     * 获取所有书架列表
     */
    @GetMapping
    public ApiResponse<List<Bookshelf>> listAll() {
        return ApiResponse.success(bookshelfService.listAll());
    }

    /**
     * 创建新书架
     */
    @PostMapping
    public ApiResponse<Bookshelf> create(@RequestBody BookshelfRequest request) {
        return ApiResponse.success(bookshelfService.create(request.getName()));
    }

    /**
     * 更新书架名称
     */
    @PutMapping("/{id}")
    public ApiResponse<Bookshelf> update(@PathVariable Long id, @RequestBody BookshelfRequest request) {
        return ApiResponse.success(bookshelfService.update(id, request.getName()));
    }

    /**
     * 删除书架（同时删除书架与书的关联，不删除书本身）
     */
    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        bookshelfService.delete(id);
        return ApiResponse.success("Shelf deleted", null);
    }

    /**
     * 书架排序（拖拽排序后的重置）
     */
    @PostMapping("/reorder")
    public ApiResponse<Void> reorder(@RequestBody ReorderRequest request) {
        bookshelfService.reorder(request.getShelfIds());
        return ApiResponse.success("Reordered", null);
    }

    /**
     * 获取书架统计信息（书本数、已读/未读数）
     */
    @GetMapping("/{id}/stats")
    public ApiResponse<ShelfStats> getStats(@PathVariable Long id) {
        return ApiResponse.success(bookshelfService.getStats(id));
    }
}
