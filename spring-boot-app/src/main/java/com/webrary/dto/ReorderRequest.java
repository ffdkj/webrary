package com.webrary.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 重排序请求DTO，用于调整书架的显示顺序。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ReorderRequest {
    /** 按新顺序排列的书架ID列表 */
    private List<Long> shelfIds;
}
