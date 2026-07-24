package com.webrary.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BookInfo {
    private Long id;
    private String title;
    private String author;
    private String cover;
    private String extension;
    private Long filesize;
    private String filesizeString;
    private String hash;
    private Integer year;
    private String language;
    private String description;
    private Integer pages;
    private String publisher;
    private String series;
}
