package com.webrary.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 阅读历史条目DTO，记录最近阅读的书籍及时间。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class HistoryEntry {
    /** 书籍ID */
    private Long bookId;
    /** 书名 */
    private String title;
    /** 作者 */
    private String author;
    /** 封面图片URL */
    private String coverUrl;
    /** 文件扩展名 */
    private String extension;
    /** 最近阅读时间 */
    private LocalDateTime lastReadAt;
}
