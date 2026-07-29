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
public class HistoryEntry {
    private Long bookId;
    private String title;
    private String author;
    private String coverUrl;
    private String extension;
    private LocalDateTime lastReadAt;
}
