package com.webrary.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 搜索结果DTO，包含搜索结果的书单及分页信息。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchResult {
    /** 搜索状态码（1 表示成功） */
    private int success;
    /** 搜索结果书籍列表 */
    private List<BookInfo> books;
    /** 当前页码 */
    private int page;
    /** 每页数量 */
    private int limit;
    /** 搜索结果总数 */
    private int total;
}
