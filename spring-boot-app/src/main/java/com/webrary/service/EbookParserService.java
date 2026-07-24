package com.webrary.service;

import com.webrary.dto.EbookMetadata;
import com.webrary.dto.TocEntry;
import lombok.extern.slf4j.Slf4j;
import nl.siegmann.epublib.domain.Book;
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
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
@Slf4j
public class EbookParserService {

    private static final Pattern TXT_CHAPTER_PATTERN =
            Pattern.compile("第[一二三四五六七八九十百千0-9]+[章节回卷篇部].*");
    private static final int CHARS_PER_PAGE = 2000;

    public EbookMetadata parseFile(Path filePath, String extension) throws IOException {
        String ext = (extension != null ? extension.toLowerCase().replace(".", "") : "");

        return switch (ext) {
            case "epub" -> parseEpub(filePath);
            case "pdf" -> parsePdf(filePath);
            case "txt" -> parseTxt(filePath);
            default -> EbookMetadata.builder().build();
        };
    }

    private EbookMetadata parseEpub(Path filePath) throws IOException {
        EpubReader epubReader = new EpubReader();
        Book epubBook = epubReader.readEpub(new FileInputStream(filePath.toFile()));

        String title = epubBook.getTitle();

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

        List<TocEntry> toc = new ArrayList<>();
        if (epubBook.getTableOfContents() != null && epubBook.getTableOfContents().getTocReferences() != null) {
            collectEpubToc(epubBook.getTableOfContents().getTocReferences(), toc);
        }

        return EbookMetadata.builder()
                .title(title)
                .author(author)
                .coverBytes(coverBytes)
                .coverFormat(coverFormat)
                .toc(toc)
                .build();
    }

    private void collectEpubToc(List<TOCReference> references, List<TocEntry> toc) {
        for (TOCReference ref : references) {
            TocEntry entry = TocEntry.builder()
                    .title(ref.getTitle())
                    .chapterIndex(toc.size())
                    .href(ref.getResource() != null ? ref.getResource().getHref() : null)
                    .build();
            toc.add(entry);

            if (ref.getChildren() != null && !ref.getChildren().isEmpty()) {
                collectEpubToc(ref.getChildren(), toc);
            }
        }
    }

    private EbookMetadata parsePdf(Path filePath) throws IOException {
        try (PDDocument doc = Loader.loadPDF(filePath.toFile())) {
            String title = null;
            String author = null;
            if (doc.getDocumentInformation() != null) {
                title = doc.getDocumentInformation().getTitle();
                author = doc.getDocumentInformation().getAuthor();
            }

            int pages = doc.getNumberOfPages();

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

            List<TocEntry> toc = new ArrayList<>();
            PDDocumentOutline outline = doc.getDocumentCatalog().getDocumentOutline();
            if (outline != null) {
                collectPdfOutline(outline, toc, doc);
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

    private void collectPdfOutline(PDOutlineNode node, List<TocEntry> toc, PDDocument doc) {
        for (PDOutlineItem item : node.children()) {
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
                    .build();
            toc.add(entry);

            collectPdfOutline(item, toc, doc);
        }
    }

    private EbookMetadata parseTxt(Path filePath) throws IOException {
        String content = Files.readString(filePath, StandardCharsets.UTF_8);
        List<String> lines = content.lines().toList();

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

        int estimatedPages = (int) Math.ceil((double) content.length() / CHARS_PER_PAGE);

        return EbookMetadata.builder()
                .toc(toc)
                .pages(estimatedPages)
                .build();
    }
}
