package com.webrary.dto;

import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 搜索请求DTO，封装书籍搜索时的各项过滤参数。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchRequest {
    /** 搜索关键词 */
    private String message;
    /** 出版年份起始 */
    private Integer yearFrom;
    /** 出版年份截止 */
    private Integer yearTo;
    /** 语言过滤（如 zh、en） */
    private String languages;
    /** 文件扩展名过滤列表 */
    private List<String> extensions;
    /** 排序方式 */
    private String order;
    /** 页码（分页） */
    private Integer page;
    /** 每页数量（分页） */
    private Integer limit;
}
