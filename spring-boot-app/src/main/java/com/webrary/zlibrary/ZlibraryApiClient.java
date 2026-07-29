package com.webrary.zlibrary;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.webrary.dto.BookInfo;
import com.webrary.dto.DownloadInfo;
import com.webrary.dto.SearchResult;
import com.webrary.dto.ZlibraryUserInfo;
import okhttp3.*;
import okhttp3.Dns;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.UnknownHostException;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * Z-Library API 客户端 — 封装对 Z-Library EAPI 接口的 HTTP 调用。
 * 支持登录（邮箱密码/token）、搜索、获取书籍信息、下载文件及用户信息查询。
 * 同时支持自定义域名和 HTTP 代理。
 */
public class ZlibraryApiClient {

    // 默认 Z-Library 域名
    private static final String DEFAULT_DOMAIN = "fuckfbi.ru";

    private final String domain;
    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;
    // 存储认证 Cookie（remix_userid, remix_userkey）
    private final Map<String, String> cookies;

    // 登录后回填的用户信息
    private ZlibraryUserInfo userInfo;

    /**
     * 无参构造：使用默认域名，无代理。
     */
    public ZlibraryApiClient() {
        this(DEFAULT_DOMAIN, null, null);
    }

    /**
     * 使用指定域名构造，无代理。
     */
    public ZlibraryApiClient(String domain) {
        this(domain, null, null);
    }

    /**
     * 完整构造：指定域名和可选的 HTTP 代理。
     * @param domain Z-Library 域名
     * @param proxyHost 代理主机（可选）
     * @param proxyPort 代理端口（可选）
     */
    public ZlibraryApiClient(String domain, String proxyHost, Integer proxyPort) {
        this.domain = (domain != null && !domain.isBlank()) ? domain : DEFAULT_DOMAIN;
        this.cookies = new HashMap<>();
        this.objectMapper = new ObjectMapper();

        // 构建 OkHttpClient，配置超时和 DNS 解析（IPv4 优先）
        OkHttpClient.Builder builder = new OkHttpClient.Builder()
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS)
                .writeTimeout(30, TimeUnit.SECONDS)
                .dns(hostname -> {
                    // DNS 解析：IPv4 地址优先
                    List<InetAddress> addresses = Dns.SYSTEM.lookup(hostname);
                    List<InetAddress> ipv4 = new ArrayList<>();
                    List<InetAddress> ipv6 = new ArrayList<>();
                    for (InetAddress addr : addresses) {
                        if (addr.getAddress().length == 4) ipv4.add(addr);
                        else ipv6.add(addr);
                    }
                    ipv4.addAll(ipv6);
                    return ipv4.isEmpty() ? addresses : ipv4;
                });

        // 如果配置了代理，设置 HTTP 代理
        if (proxyHost != null && !proxyHost.isBlank() && proxyPort != null && proxyPort > 0) {
            builder.proxy(new Proxy(Proxy.Type.HTTP, new InetSocketAddress(proxyHost, proxyPort)));
        }

        this.httpClient = builder.build();
    }

    /**
     * 获取完整的 API 基础 URL（https://域名）。
     */
    private String getBaseUrl() {
        return "https://" + domain;
    }

    /**
     * 构建通用请求头（浏览器 User-Agent）。
     */
    private Headers buildHeaders() {
        Headers.Builder builder = new Headers.Builder();
        builder.add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
        builder.add("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8");
        builder.add("Accept-Language", "en-US,en;q=0.5");
        return builder.build();
    }

    /**
     * 构建表单请求头（Content-Type: application/x-www-form-urlencoded）。
     */
    private Headers buildFormHeaders() {
        Headers.Builder builder = new Headers.Builder();
        builder.add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
        builder.add("Content-Type", "application/x-www-form-urlencoded");
        builder.add("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8");
        return builder.build();
    }

    /**
     * 将 Cookie Map 拼接为 HTTP Cookie 头的值。
     */
    private String getCookieHeader() {
        if (cookies.isEmpty()) return null;
        return cookies.entrySet().stream()
                .map(e -> e.getKey() + "=" + e.getValue())
                .collect(Collectors.joining("; "));
    }

    /**
     * 从响应头中提取 Set-Cookie 并存储到 cookies Map。
     */
    private void storeCookies(Headers headers) {
        List<String> setCookies = headers.values("Set-Cookie");
        for (String sc : setCookies) {
            String[] parts = sc.split(";");
            if (parts.length > 0) {
                String[] kv = parts[0].trim().split("=", 2);
                if (kv.length == 2) {
                    cookies.put(kv[0].trim(), kv[1].trim());
                }
            }
        }
    }

    /**
     * 构建带认证 Cookie 的 GET 请求。
     */
    private Request.Builder baseRequest(String path) {
        Request.Builder builder = new Request.Builder()
                .url(getBaseUrl() + path)
                .headers(buildHeaders());
        String cookie = getCookieHeader();
        if (cookie != null) {
            builder.addHeader("Cookie", cookie);
        }
        return builder;
    }

    /**
     * 构建带认证 Cookie 的表单 POST 请求。
     */
    private Request.Builder baseFormRequest(String path, FormBody.Builder formBody) {
        Request.Builder builder = new Request.Builder()
                .url(getBaseUrl() + path)
                .headers(buildFormHeaders());
        String cookie = getCookieHeader();
        if (cookie != null) {
            builder.addHeader("Cookie", cookie);
        }
        return builder;
    }

    /**
     * 执行 HTTP 请求并解析 JSON 响应。
     */
    private JsonNode execute(Request request) throws IOException {
        try (Response response = httpClient.newCall(request).execute()) {
            storeCookies(response.headers());
            String body = response.body() != null ? response.body().string() : "{}";
            return objectMapper.readTree(body);
        }
    }

    /**
     * 执行 HTTP 请求并返回字节数组。
     */
    private byte[] executeForBytes(Request request) throws IOException {
        try (Response response = httpClient.newCall(request).execute()) {
            return response.body() != null ? response.body().bytes() : new byte[0];
        }
    }

    /**
     * 执行 HTTP 请求并返回字节数组（带下载进度回调）。
     * @param onProgress 进度回调，参数为已下载字节数
     */
    private byte[] executeForBytesWithProgress(Request request, java.util.function.Consumer<Long> onProgress) throws IOException {
        try (Response response = httpClient.newCall(request).execute()) {
            ResponseBody body = response.body();
            if (body == null) return new byte[0];
            long contentLength = body.contentLength();
            InputStream is = body.byteStream();
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            long totalRead = 0;
            // 分块读取并回调进度
            while ((read = is.read(buffer)) != -1) {
                baos.write(buffer, 0, read);
                totalRead += read;
                if (onProgress != null) onProgress.accept(totalRead);
            }
            return baos.toByteArray();
        }
    }

    /**
     * 使用邮箱和密码登录 Z-Library。
     * @return 登录成功后的用户信息
     */
    /**
     * Log in with email and password.
     */
    public ZlibraryUserInfo login(String email, String password) throws IOException {
        FormBody formBody = new FormBody.Builder()
                .add("email", email)
                .add("password", password)
                .build();

        Request request = baseFormRequest("/eapi/user/login", null)
                .post(formBody)
                .build();

        JsonNode json = execute(request);

        // 校验登录结果
        if (!json.has("success") || json.get("success").asInt() != 1) {
            String errorMsg = json.has("error") ? json.get("error").asText() : "Login failed";
            throw new IOException("Z-Library login failed: " + errorMsg);
        }

        // 解析用户信息
        JsonNode user = json.get("user");
        userInfo = ZlibraryUserInfo.builder()
                .id(user.has("id") ? user.get("id").asLong() : null)
                .email(user.has("email") ? user.get("email").asText() : null)
                .name(user.has("name") ? user.get("name").asText() : null)
                .kindleEmail(user.has("kindle_email") ? user.get("kindle_email").asText() : null)
                .remixUserkey(user.has("remix_userkey") ? user.get("remix_userkey").asText() : null)
                .downloadsToday(user.has("downloads_today") ? user.get("downloads_today").asInt() : 0)
                .downloadsLimit(user.has("downloads_limit") ? user.get("downloads_limit").asInt() : 0)
                .confirmed(user.has("confirmed") ? user.get("confirmed").asBoolean() : false)
                .isPremium(user.has("isPremium") ? user.get("isPremium").asBoolean() : false)
                .build();

        return userInfo;
    }

    /**
     * 使用已存储的 remix token 登录（无网络调用，仅设置 Cookie）。
     * @param remixUserId Z-Library 用户 ID
     * @param remixUserKey Z-Library 用户密钥
     */
    /**
     * Log in with stored remix tokens (no actual API call, just set cookies).
     */
    public void loginWithToken(String remixUserId, String remixUserKey) {
        cookies.put("remix_userid", remixUserId);
        cookies.put("remix_userkey", remixUserKey);
    }

    /**
     * 检查客户端是否已登录（是否拥有 remix_userid 和 remix_userkey Cookie）。
     */
    /**
     * Check if the client is logged in (has session cookies).
     */
    public boolean isLoggedIn() {
        return cookies.containsKey("remix_userid") && cookies.containsKey("remix_userkey");
    }

    /**
     * 搜索 Z-Library 书籍。
     * @param query 搜索关键词
     * @param options 搜索选项（年份、语言、扩展名、排序、分页等）
     * @return 搜索结果
     */
    /**
     * Search for books.
     */
    public SearchResult search(String query, Map<String, Object> options) throws IOException {
        FormBody.Builder formBuilder = new FormBody.Builder();
        formBuilder.add("message", query != null ? query : "");

        // 填充搜索选项
        if (options != null) {
            if (options.containsKey("yearFrom")) formBuilder.add("yearFrom", String.valueOf(options.get("yearFrom")));
            if (options.containsKey("yearTo")) formBuilder.add("yearTo", String.valueOf(options.get("yearTo")));
            if (options.containsKey("languages")) formBuilder.add("languages", (String) options.get("languages"));
            if (options.containsKey("extensions")) {
                @SuppressWarnings("unchecked")
                List<String> exts = (List<String>) options.get("extensions");
                for (String ext : exts) {
                    formBuilder.add("extensions[]", ext);
                }
            }
            if (options.containsKey("order")) formBuilder.add("order", (String) options.get("order"));
            if (options.containsKey("page")) formBuilder.add("page", String.valueOf(options.get("page")));
            if (options.containsKey("limit")) formBuilder.add("limit", String.valueOf(options.get("limit")));
        }

        Request request = baseFormRequest("/eapi/book/search", null)
                .post(formBuilder.build())
                .build();

        JsonNode json = execute(request);

        // 解析搜索结果中的书籍列表
        List<BookInfo> books = new ArrayList<>();
        if (json.has("books")) {
            for (JsonNode b : json.get("books")) {
                BookInfo book = BookInfo.builder()
                        .id(b.has("id") ? b.get("id").asLong() : null)
                        .title(b.has("title") ? b.get("title").asText() : null)
                        .author(b.has("author") ? b.get("author").asText() : null)
                        .cover(b.has("cover") ? b.get("cover").asText() : null)
                        .extension(b.has("extension") ? b.get("extension").asText() : null)
                        .filesize(b.has("filesize") ? b.get("filesize").asLong() : null)
                        .filesizeString(b.has("filesizeString") ? b.get("filesizeString").asText() : null)
                        .hash(b.has("hash") ? b.get("hash").asText() : null)
                        .year(b.has("year") ? b.get("year").asInt() : null)
                        .language(b.has("language") ? b.get("language").asText() : null)
                        .description(b.has("description") ? b.get("description").asText() : null)
                        .pages(b.has("pages") ? b.get("pages").asInt() : null)
                        .publisher(b.has("publisher") ? b.get("publisher").asText() : null)
                        .series(b.has("series") ? b.get("series").asText() : null)
                        .build();
                books.add(book);
            }
        }

        return SearchResult.builder()
                .success(json.has("success") ? json.get("success").asInt() : 0)
                .books(books)
                .page(options != null && options.containsKey("page") ? (Integer) options.get("page") : 1)
                .limit(options != null && options.containsKey("limit") ? (Integer) options.get("limit") : 10)
                .total(json.has("total") ? json.get("total").asInt() : books.size())
                .build();
    }

    /**
     * 根据书籍 ID 和哈希获取书籍详细信息。
     */
    /**
     * Get book info by id and hash.
     */
    public JsonNode getBookInfo(Long bookId, String hash) throws IOException {
        Request request = baseRequest("/eapi/book/" + bookId + "/" + hash)
                .get()
                .build();
        return execute(request);
    }

    /**
     * 获取书籍的下载链接信息。
     */
    /**
     * Get download link for a book.
     */
    public DownloadInfo getDownloadLink(Long bookId, String hash) throws IOException {
        Request request = baseRequest("/eapi/book/" + bookId + "/" + hash + "/file")
                .get()
                .build();

        JsonNode json = execute(request);

        if (!json.has("file")) {
            throw new IOException("No download file info available");
        }

        JsonNode file = json.get("file");

        return DownloadInfo.builder()
                .downloadLink(file.has("downloadLink") ? file.get("downloadLink").asText() : null)
                .filename(file.has("filename") ? file.get("filename").asText() : null)
                .description(file.has("description") ? file.get("description").asText() : null)
                .author(file.has("author") ? file.get("author").asText() : null)
                .extension(file.has("extension") ? file.get("extension").asText() : null)
                .filesize(file.has("filesize") ? file.get("filesize").asLong() : null)
                .build();
    }

    /**
     * 下载书籍文件内容（返回字节数组）。
     * 先获取下载链接，再通过链接下载文件。
     */
    /**
     * Download a book's file content as bytes.
     */
    public byte[] downloadBook(Long bookId, String hash) throws IOException {
        DownloadInfo downloadInfo = getDownloadLink(bookId, hash);
        if (downloadInfo.getDownloadLink() == null) {
            throw new IOException("No download link available");
        }

        Request request = new Request.Builder()
                .url(downloadInfo.getDownloadLink())
                .headers(buildHeaders())
                .get()
                .build();

        return executeForBytes(request);
    }

    /**
     * 带进度回调的书籍下载。
     */
    public byte[] downloadBookWithProgress(Long bookId, String hash, java.util.function.Consumer<Long> onProgress) throws IOException {
        DownloadInfo downloadInfo = getDownloadLink(bookId, hash);
        if (downloadInfo.getDownloadLink() == null) {
            throw new IOException("No download link available");
        }

        Request request = new Request.Builder()
                .url(downloadInfo.getDownloadLink())
                .headers(buildHeaders())
                .get()
                .build();

        return executeForBytesWithProgress(request, onProgress);
    }

    /**
     * 获取用户个人信息。
     */
    /**
     * Get user profile.
     */
    public JsonNode getProfile() throws IOException {
        Request request = baseRequest("/eapi/user/profile")
                .get()
                .build();
        return execute(request);
    }

    /**
     * 获取当日剩余下载次数。
     */
    /**
     * Get downloads remaining for today.
     */
    public int getDownloadsLeft() {
        if (userInfo == null) return 0;
        return Math.max(0, userInfo.getDownloadsLimit() - userInfo.getDownloadsToday());
    }

    /**
     * 获取最受欢迎书籍列表。
     */
    /**
     * Get most popular books.
     */
    public SearchResult getMostPopular() throws IOException {
        Request request = baseRequest("/eapi/book/most-popular")
                .get()
                .build();

        JsonNode json = execute(request);

        // 解析书籍列表
        List<BookInfo> books = new ArrayList<>();
        if (json.has("books")) {
            for (JsonNode b : json.get("books")) {
                BookInfo book = BookInfo.builder()
                        .id(b.has("id") ? b.get("id").asLong() : null)
                        .title(b.has("title") ? b.get("title").asText() : null)
                        .author(b.has("author") ? b.get("author").asText() : null)
                        .cover(b.has("cover") ? b.get("cover").asText() : null)
                        .extension(b.has("extension") ? b.get("extension").asText() : null)
                        .filesize(b.has("filesize") ? b.get("filesize").asLong() : null)
                        .filesizeString(b.has("filesizeString") ? b.get("filesizeString").asText() : null)
                        .hash(b.has("hash") ? b.get("hash").asText() : null)
                        .year(b.has("year") ? b.get("year").asInt() : null)
                        .language(b.has("language") ? b.get("language").asText() : null)
                        .description(b.has("description") ? b.get("description").asText() : null)
                        .pages(b.has("pages") ? b.get("pages").asInt() : null)
                        .publisher(b.has("publisher") ? b.get("publisher").asText() : null)
                        .series(b.has("series") ? b.get("series").asText() : null)
                        .build();
                books.add(book);
            }
        }

        return SearchResult.builder()
                .success(json.has("success") ? json.get("success").asInt() : 0)
                .books(books)
                .total(books.size())
                .build();
    }

    /**
     * 获取当前存储的 Cookie 快照（用于持久化）。
     */
    /**
     * Get stored cookies (for persistence).
     */
    public Map<String, String> getCookies() {
        return new HashMap<>(cookies);
    }

    /**
     * 获取已存储的用户信息。
     */
    /**
     * Get the stored user info.
     */
    public ZlibraryUserInfo getUserInfo() {
        return userInfo;
    }

    /**
     * 设置用户信息。
     */
    /**
     * Set stored user info.
     */
    public void setUserInfo(ZlibraryUserInfo userInfo) {
        this.userInfo = userInfo;
    }

    /**
     * 登出：清除所有 Cookie 和用户信息。
     */
    /**
     * Logout: clear cookies and user info.
     */
    public void logout() {
        cookies.clear();
        userInfo = null;
    }
}
