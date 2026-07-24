package com.webrary.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class EbookMetadata {
    private String title;
    private String author;
    private byte[] coverBytes;
    private String coverFormat;
    private Integer pages;
    private List<TocEntry> toc;
}
