package com.webrary.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 电子书元数据DTO，包含从电子书文件中提取的信息。
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class EbookMetadata {
    /** 书名 */
    private String title;
    /** 作者 */
    private String author;
    /** 封面图片字节数据 */
    private byte[] coverBytes;
    /** 封面图片格式（如 png、jpg） */
    private String coverFormat;
    /** 总页数 */
    private Integer pages;
    /** 目录列表 */
    private List<TocEntry> toc;
}
