package com.webrary.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 书架统计DTO，展示书架的阅读统计信息。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ShelfStats {
    /** 书架中的书籍总数 */
    private int bookCount;
    /** 未读数量 */
    private int unreadCount;
    /** 已读完成数量 */
    private int finishedCount;
}
