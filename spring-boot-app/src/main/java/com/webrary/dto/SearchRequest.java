package com.webrary.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchRequest {
    private String message;
    private Integer yearFrom;
    private Integer yearTo;
    private String languages;
    private String extensions;
    private String order;
    private Integer page;
    private Integer limit;
}
