package com.webrary.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 转移请求DTO，用于将书籍从一个书架移动到另一个书架。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TransferRequest {
    /** 源书架ID */
    private Long fromShelfId;
    /** 目标书架ID */
    private Long toShelfId;
    /** 要移动的书籍ID */
    private Long bookId;
}
