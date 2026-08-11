
# Spring Boot电子书解析模块开发指南

## 项目背景

本项目是一个基于 Spring Boot 的 B/S 图书阅读器。

用户上传或下载zlibrary电子书后，系统需要自动解析：

- 文件格式
- 标题
- 作者
- 封面
- 描述信息
- 目录（TOC）
- 页数
- 阅读章节信息


支持格式：

- EPUB
- PDF
- TXT
- MOBI/AZW3（通过转换）

当前重点：

- EPUB解析
- PDF解析


---

# 一、整体解析架构


不要在业务代码中直接判断文件类型：

错误：

```java
if(type=="epub"){

}

else if(type=="pdf"){

}
推荐使用策略模式：

BookParser

    |
    |
---------------------

EpubParser

PdfParser

TxtParser
统一返回：

public class ParsedBook {


    private String title;


    private String author;


    private String coverPath;


    private List<TocItem> toc;


}
目录结构：

public class TocItem {


    private String title;


    private String href;


    private Integer level;


    private Integer sort;

}
二、EPUB解析
使用库
epublib

Maven:

<dependency>
    <groupId>com.positiondev.epublib</groupId>
    <artifactId>epublib-core</artifactId>
    <version>3.1</version>
</dependency>
1. EPUB基础知识
EPUB实际上是一个ZIP文件。

结构：

book.epub

|
|-- META-INF
|
|-- OEBPS
|
    |-- content.opf

    |-- toc.ncx

    |-- nav.xhtml

    |-- chapter1.xhtml
包含：

metadata

cover

XHTML正文

TOC目录

2. 打开EPUB
FileInputStream input =
        new FileInputStream(
            "book.epub"
        );


Book book =
        new EpubReader()
        .readEpub(input);
3. 获取标题
String title =
book.getTitle();
4. 获取作者
book.getMetadata()
    .getAuthors()
    .forEach(author -> {

        System.out.println(
            author.getFirstname()
        );

    });
5. 获取封面
Resource cover =
book.getCoverImage();


byte[] data =
cover.getData();
保存：

Files.write(
    Paths.get(
        "cover.jpg"
    ),
    data
);
6. 获取目录
EPUB目录来源：

toc.ncx

nav.xhtml

获取：

TOCReference root =
book.getTableOfContents();
遍历：

private void parseTOC(
    List<TOCReference> refs,
    int level
){

    for(
        TOCReference ref:refs
    ){

        System.out.println(
            ref.getTitle()
        );


        parseTOC(
            ref.getChildren(),
            level+1
        );

    }

}
输出：

第一卷

 第一章

 第二章

第二卷

 第三章
三、PDF解析
使用库
Apache PDFBox

Maven:

<dependency>
    <groupId>org.apache.pdfbox</groupId>
    <artifactId>pdfbox</artifactId>
    <version>3.0.3</version>
</dependency>
1. 打开PDF
PDDocument document =
        Loader.loadPDF(
            new File(
                "book.pdf"
            )
        );
2. 获取PDF元数据
PDDocumentInformation info =
document.getDocumentInformation();


String title =
info.getTitle();


String author =
info.getAuthor();
3. 获取页数
int pages =
document.getNumberOfPages();
4. 获取PDF目录
PDF目录称为：

Outline

获取：

PDDocumentOutline outline =
document
.getDocumentCatalog()
.getDocumentOutline();
遍历：

PDOutlineItem item =
outline.getFirstChild();


while(item!=null){


    System.out.println(
        item.getTitle()
    );


    item =
    item.getNextSibling();

}
输出：

第一章

第二章

第三章
5. PDF无目录情况
注意：

不是所有PDF都有目录。

例如：

扫描PDF：

第一页图片

第二页图片
没有：

Outline
需要：

OCR

或者

AI分析目录页。

四、Spring Boot服务设计
推荐结构：

service

 |

 |-- BookParserService

 |

 |-- parser

       |

       |-- EpubParser

       |

       |-- PdfParser
五、Parser接口
public interface BookParser {


    ParsedBook parse(
        File file
    );


}
六、EPUB Parser示例
@Component
public class EpubParser
implements BookParser{


@Override
public ParsedBook parse(
File file
){

    Book book =
    new EpubReader()
    .readEpub(
        new FileInputStream(file)
    );


    ParsedBook result =
    new ParsedBook();


    result.setTitle(
        book.getTitle()
    );


    return result;

}

}
七、PDF Parser示例
@Component
public class PdfParser
implements BookParser{


@Override
public ParsedBook parse(
File file
){


PDDocument document =
Loader.loadPDF(file);


PDDocumentInformation info =
document.getDocumentInformation();


ParsedBook book =
new ParsedBook();


book.setTitle(
info.getTitle()
);


return book;


}

}