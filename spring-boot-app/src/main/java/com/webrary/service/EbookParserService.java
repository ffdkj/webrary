package com.webrary.service;

import com.webrary.dto.EbookMetadata;
import com.webrary.dto.TocEntry;
import lombok.extern.slf4j.Slf4j;
import nl.siegmann.epublib.domain.Book;
import nl.siegmann.epublib.domain.Resource;
import nl.siegmann.epublib.domain.TOCReference;
import nl.siegmann.epublib.epub.EpubReader;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.interactive.documentnavigation.outline.PDDocumentOutline;
import org.apache.pdfbox.pdmodel.interactive.documentnavigation.outline.PDOutlineItem;
import org.apache.pdfbox.pdmodel.interactive.documentnavigation.outline.PDOutlineNode;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 电子书解析服务 — 解析 EPUB、PDF、TXT 格式文件，提取标题、作者、封面、页码和目录等元数据。
 */
@Service
@Slf4j
public class EbookParserService {

    // TXT 章节匹配模式（匹配"第X章"、"第X节"等格式）
    private static final Pattern TXT_CHAPTER_PATTERN =
            Pattern.compile("第[一二三四五六七八九十百千0-9]+[章节回卷篇部].*");
    // 每页估算字符数（用于 TXT 分页）
    private static final int CHARS_PER_PAGE = 2000;

    /**
     * 根据文件扩展名调用对应的解析方法。
     */
    public EbookMetadata parseFile(Path filePath, String extension) throws IOException {
        String ext = (extension != null ? extension.toLowerCase().replace(".", "") : "");

        return switch (ext) {
            case "epub" -> parseEpub(filePath);
            case "pdf" -> parsePdf(filePath);
            case "txt" -> parseTxt(filePath);
            default -> EbookMetadata.builder().build();
        };
    }

    /**
     * 解析 EPUB 文件：提取标题、作者、封面图片和目录结构。
     */
    private EbookMetadata parseEpub(Path filePath) throws IOException {
        EpubReader epubReader = new EpubReader();
        Book epubBook = epubReader.readEpub(new FileInputStream(filePath.toFile()));

        String title = epubBook.getTitle();

        // 提取作者信息（取第一位作者，拼接 firstname + lastname）
        String author = null;
        if (epubBook.getMetadata() != null && epubBook.getMetadata().getAuthors() != null
                && !epubBook.getMetadata().getAuthors().isEmpty()) {
            var firstAuthor = epubBook.getMetadata().getAuthors().get(0);
            String first = firstAuthor.getFirstname() != null ? firstAuthor.getFirstname() : "";
            String last = firstAuthor.getLastname() != null ? firstAuthor.getLastname() : "";
            author = (first + " " + last).trim();
            if (author.isEmpty()) {
                author = null;
            }
        }

        // 提取封面图片数据
        byte[] coverBytes = null;
        String coverFormat = null;
        if (epubBook.getCoverImage() != null) {
            coverBytes = epubBook.getCoverImage().getData();
            if (epubBook.getCoverImage().getMediaType() != null) {
                var mediaType = epubBook.getCoverImage().getMediaType();
                if (mediaType.getName() != null) {
                    coverFormat = mediaType.getName();
                }
            }
        }

        // 从 NCX 提取目录
        List<TocEntry> toc = new ArrayList<>();
        if (epubBook.getTableOfContents() != null && epubBook.getTableOfContents().getTocReferences() != null) {
            collectEpubToc(epubBook.getTableOfContents().getTocReferences(), toc);
        }

        // 如果 NCX 目录条目太少，从 XHTML TOC 页面补充详细章节信息
        // Supplement with chapter details from XHTML TOC pages if NCX only has shallow entries
        if (toc.size() < 10) {
            supplementEpubTocFromXhtml(epubBook, toc);
        }

        return EbookMetadata.builder()
                .title(title)
                .author(author)
                .coverBytes(coverBytes)
                .coverFormat(coverFormat)
                .toc(toc)
                .build();
    }

    /**
     * 递归收集 EPUB NCX 目录条目。
     */
    private void collectEpubToc(List<TOCReference> references, List<TocEntry> toc) {
        collectEpubToc(references, toc, 0);
    }

    /**
     * 递归遍历 NCX 目录树，将条目添加到列表中。
     * @param references 当前层级的目录引用
     * @param toc 目标目录条目列表
     * @param level 当前层级（0 = 顶级）
     */
    private void collectEpubToc(List<TOCReference> references, List<TocEntry> toc, int level) {
        for (TOCReference ref : references) {
            TocEntry entry = TocEntry.builder()
                    .title(ref.getTitle())
                    .chapterIndex(toc.size())
                    .href(ref.getResource() != null ? ref.getResource().getHref() : null)
                    .level(level)
                    .build();
            toc.add(entry);

            // 递归处理子条目
            if (ref.getChildren() != null && !ref.getChildren().isEmpty()) {
                collectEpubToc(ref.getChildren(), toc, level + 1);
            }
        }
    }

    /**
     * 从 EPUB 的 XHTML TOC 页面补充目录信息。
     * 许多 EPUB 文件将详细章节 TOC 存储在 XHTML 文件中，而 NCX 仅有顶层条目，
     * 此方法解析这些 XHTML 页面提取完整的章节列表。
     */
    /**
     * Supplement TOC by parsing XHTML TOC pages (e.g., part0003.xhtml with id "x_x1TOC.xhtml")
     * that contain detailed chapter listings. Many EPUBs store the real chapter TOC in XHTML
     * files while the NCX only has top-level entries.
     */
    private void supplementEpubTocFromXhtml(Book epubBook, List<TocEntry> toc) {
        // 记录已存在的标题，避免重复添加
        Set<String> existingTitles = new HashSet<>();
        for (TocEntry e : toc) existingTitles.add(e.getTitle());

        // 遍历 EPUB 的全部资源文件
        for (Resource resource : epubBook.getResources().getAll()) {
            String href = resource.getHref();
            String id = resource.getId();
            if (href == null) continue;

            String hrefLower = href.toLowerCase();
            // 仅处理 XHTML/HTML 文件
            if (!hrefLower.endsWith(".xhtml") && !hrefLower.endsWith(".html")) continue;

            // 判断是否为 TOC 页面（通过 ID 或文件名包含 toc 判断）
            boolean isTocPage = (id != null && id.contains(".") && id.toUpperCase().contains("TOC"))
                    || hrefLower.contains("toc")
                    || hrefLower.equals("nav.xhtml");
            if (!isTocPage) continue;

            byte[] data;
            try {
                data = resource.getData();
            } catch (IOException e) {
                continue;
            }
            if (data == null || data.length == 0) continue;

            // 读取文件内容
            String content = new String(data, StandardCharsets.UTF_8);
            if (!content.contains("<a ")) continue;

            // 从 <h1> 标签中提取章节标题
            // Extract section title from <h1>
            String sectionTitle = null;
            Matcher h1m = Pattern.compile("<h1[^>]*>([^<]+)</h1>").matcher(content);
            if (h1m.find()) {
                sectionTitle = h1m.group(1).trim();
                if (sectionTitle.isEmpty()) sectionTitle = null;
            }

            // 从 <a> 标签中提取章节链接
            // Extract <a href="..." title</a> chapter links
            Matcher lm = Pattern.compile("<a\\s+href=\"([^\"]+)\"[^>]*>([^<]+)</a>").matcher(content);
            List<String[]> links = new ArrayList<>();
            while (lm.find()) {
                String lh = lm.group(1);
                String lt = lm.group(2).trim();
                // 跳过空标题、空链接和锚点链接
                if (lt.isEmpty() || lh.isEmpty() || lh.startsWith("#")) continue;
                links.add(new String[]{lh, lt});
            }
            if (links.size() < 2) continue;

            // 计算相对路径基路径
            String baseDir = href.contains("/") ? href.substring(0, href.lastIndexOf('/') + 1) : "";

            // 添加章节标题作为顶级目录
            if (sectionTitle != null && !existingTitles.contains(sectionTitle)) {
                toc.add(TocEntry.builder()
                        .title(sectionTitle)
                        .chapterIndex(toc.size())
                        .href(href)
                        .level(0)
                        .build());
                existingTitles.add(sectionTitle);
            }

            // 添加各章链接作为子级目录
            for (String[] link : links) {
                if (existingTitles.contains(link[1])) continue;
                toc.add(TocEntry.builder()
                        .title(link[1])
                        .chapterIndex(toc.size())
                        .href(baseDir + link[0])
                        .level(1)
                        .build());
                existingTitles.add(link[1]);
            }
        }
    }

    /**
     * 解析 PDF 文件：提取标题、作者、封面（第一页渲染）、页码和书签目录。
     */
    private EbookMetadata parsePdf(Path filePath) throws IOException {
        try (PDDocument doc = Loader.loadPDF(filePath.toFile())) {
            String title = null;
            String author = null;
            if (doc.getDocumentInformation() != null) {
                title = doc.getDocumentInformation().getTitle();
                author = doc.getDocumentInformation().getAuthor();
            }

            int pages = doc.getNumberOfPages();

            // 将第一页渲染为封面图片
            byte[] coverBytes = null;
            if (pages > 0) {
                try {
                    PDFRenderer renderer = new PDFRenderer(doc);
                    BufferedImage image = renderer.renderImageWithDPI(0, 72);
                    ByteArrayOutputStream baos = new ByteArrayOutputStream();
                    ImageIO.write(image, "JPEG", baos);
                    coverBytes = baos.toByteArray();
                } catch (Exception e) {
                    log.debug("Could not render PDF cover: {}", e.getMessage());
                }
            }

            // 提取 PDF 书签作为目录
            List<TocEntry> toc = new ArrayList<>();
            PDDocumentOutline outline = doc.getDocumentCatalog().getDocumentOutline();
            if (outline != null) {
                collectPdfOutline(outline, toc, doc, 0);
            }

            return EbookMetadata.builder()
                    .title(title)
                    .author(author)
                    .coverBytes(coverBytes)
                    .coverFormat("jpg")
                    .pages(pages)
                    .toc(toc)
                    .build();
        }
    }

    /**
     * 递归遍历 PDF 书签大纲树，提取目录条目。
     * @param node 当前大纲节点
     * @param toc 目标目录条目列表
     * @param doc PDF 文档（用于查找页码）
     * @param level 当前层级
     */
    private void collectPdfOutline(PDOutlineNode node, List<TocEntry> toc, PDDocument doc, int level) {
        for (PDOutlineItem item : node.children()) {
            // 尝试获取书签对应的页码（1-based）
            Integer startPage = null;
            try {
                var dest = item.findDestinationPage(doc);
                if (dest != null) {
                    startPage = doc.getPages().indexOf(dest) + 1; // 1-based
                }
            } catch (Exception e) {
                log.debug("Could not get page for outline item '{}': {}", item.getTitle(), e.getMessage());
            }

            TocEntry entry = TocEntry.builder()
                    .title(item.getTitle())
                    .chapterIndex(toc.size())
                    .startPage(startPage)
                    .level(level)
                    .build();
            toc.add(entry);

            // 递归处理子书签
            collectPdfOutline(item, toc, doc, level + 1);
        }
    }

    /**
     * 解析 TXT 文件：按章节模式匹配识别目录，按字符数估算页数。
     */
    private EbookMetadata parseTxt(Path filePath) throws IOException {
        String content = Files.readString(filePath, StandardCharsets.UTF_8);
        List<String> lines = content.lines().toList();

        // 按章节正则匹配生成目录
        List<TocEntry> toc = new ArrayList<>();
        for (String line : lines) {
            Matcher m = TXT_CHAPTER_PATTERN.matcher(line.trim());
            if (m.find()) {
                toc.add(TocEntry.builder()
                        .title(line.trim())
                        .chapterIndex(toc.size())
                        .build());
            }
        }

        // 按字符数估算页数（每页约 2000 字符）
        int estimatedPages = (int) Math.ceil((double) content.length() / CHARS_PER_PAGE);

        return EbookMetadata.builder()
                .toc(toc)
                .pages(estimatedPages)
                .build();
    }
}
