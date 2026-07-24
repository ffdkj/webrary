package com.webrary.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BookAddRequest {
    private Long zlibId;
    private String zlibHash;
    private String title;
    private String author;
    private String coverUrl;
    private String extension;
    private Long filesize;
    private String description;
    private String filePath;
    private boolean uploaded;
}
