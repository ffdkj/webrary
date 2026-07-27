package com.webrary.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DownloadTask {
    private String taskId;
    private Long bookId;
    private String title;
    private String author;
    private String coverUrl;
    private String extension;
    private Long totalBytes;
    private Long downloadedBytes;
    private String status;
    private String errorMessage;
    private LocalDateTime createdAt;
}
