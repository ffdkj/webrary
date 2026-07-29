package com.webrary.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 书架请求DTO，用于创建或更新书架。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BookshelfRequest {
    /** 书架名称 */
    private String name;
}
