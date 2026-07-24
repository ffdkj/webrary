package com.webrary.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DownloadInfo {
    private String downloadLink;
    private String filename;
    private String description;
    private String author;
    private String extension;
    private Long filesize;
}
