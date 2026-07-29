package com.webrary.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 下载任务DTO，用于追踪书籍下载任务的进度与状态。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DownloadTask {
    /** 下载任务唯一标识 */
    private String taskId;
    /** 关联的书籍ID */
    private Long bookId;
    /** 书名 */
    private String title;
    /** 作者 */
    private String author;
    /** 封面图片URL */
    private String coverUrl;
    /** 文件扩展名 */
    private String extension;
    /** 文件总字节数 */
    private Long totalBytes;
    /** 已下载字节数 */
    private Long downloadedBytes;
    /** 任务状态（如 downloading、completed、failed） */
    private String status;
    /** 错误信息（失败时填充） */
    private String errorMessage;
    /** 任务创建时间 */
    private LocalDateTime createdAt;
}
