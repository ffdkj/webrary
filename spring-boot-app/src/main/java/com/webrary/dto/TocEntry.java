package com.webrary.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 电子书目录条目DTO，表示电子书的一个章节/目录项。
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class TocEntry {
    /** 章节标题 */
    private String title;
    /** 章节索引序号 */
    private int chapterIndex;
    /** 起始页码 */
    private Integer startPage;
    /** 内部链接锚点 */
    private String href;
    /** 目录层级（1 为一级标题，2 为二级，以此类推） */
    private int level;
}
