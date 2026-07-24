package com.webrary.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ShelfBookResponse {
    private Long id;
    private Long bookId;
    private String title;
    private String author;
    private String coverUrl;
    private String extension;
    private Long filesize;
    private Integer unreadPages;
    private Boolean isFinished;
    private String filePath;
    private String readOnlineUrl;
    private Long zlibId;
    private String zlibHash;
}
