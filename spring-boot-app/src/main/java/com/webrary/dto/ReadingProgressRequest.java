package com.webrary.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 阅读进度请求DTO，用于更新书籍的阅读进度。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ReadingProgressRequest {
    /** 当前阅读到的页码 */
    private int currentPage;
    /** 书籍总页数 */
    private int totalPages;
    /** 是否已读完 */
    private boolean finished;
}
