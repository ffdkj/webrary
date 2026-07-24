package com.webrary.zlibrary;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.webrary.dto.BookInfo;
import com.webrary.dto.DownloadInfo;
import com.webrary.dto.SearchResult;
import com.webrary.dto.ZlibraryUserInfo;
import okhttp3.*;
import okhttp3.Dns;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.UnknownHostException;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

public class ZlibraryApiClient {

    private static final String DEFAULT_DOMAIN = "fuckfbi.ru";

    private final String domain;
    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final Map<String, String> cookies;

    private ZlibraryUserInfo userInfo;

    public ZlibraryApiClient() {
        this(DEFAULT_DOMAIN, null, null);
    }

    public ZlibraryApiClient(String domain) {
        this(domain, null, null);
    }

    public ZlibraryApiClient(String domain, String proxyHost, Integer proxyPort) {
        this.domain = (domain != null && !domain.isBlank()) ? domain : DEFAULT_DOMAIN;
        this.cookies = new HashMap<>();
        this.objectMapper = new ObjectMapper();

        OkHttpClient.Builder builder = new OkHttpClient.Builder()
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS)
                .writeTimeout(30, TimeUnit.SECONDS)
                .dns(hostname -> {
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

        if (proxyHost != null && !proxyHost.isBlank() && proxyPort != null && proxyPort > 0) {
            builder.proxy(new Proxy(Proxy.Type.HTTP, new InetSocketAddress(proxyHost, proxyPort)));
        }

        this.httpClient = builder.build();
    }

    private String getBaseUrl() {
        return "https://" + domain;
    }

    private Headers buildHeaders() {
        Headers.Builder builder = new Headers.Builder();
        builder.add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
        builder.add("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8");
        builder.add("Accept-Language", "en-US,en;q=0.5");
        return builder.build();
    }

    private Headers buildFormHeaders() {
        Headers.Builder builder = new Headers.Builder();
        builder.add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
        builder.add("Content-Type", "application/x-www-form-urlencoded");
        builder.add("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8");
        return builder.build();
    }

    private String getCookieHeader() {
        if (cookies.isEmpty()) return null;
        return cookies.entrySet().stream()
                .map(e -> e.getKey() + "=" + e.getValue())
                .collect(Collectors.joining("; "));
    }

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

    private JsonNode execute(Request request) throws IOException {
        try (Response response = httpClient.newCall(request).execute()) {
            storeCookies(response.headers());
            String body = response.body() != null ? response.body().string() : "{}";
            return objectMapper.readTree(body);
        }
    }

    private byte[] executeForBytes(Request request) throws IOException {
        try (Response response = httpClient.newCall(request).execute()) {
            return response.body() != null ? response.body().bytes() : new byte[0];
        }
    }

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

        if (!json.has("success") || json.get("success").asInt() != 1) {
            String errorMsg = json.has("error") ? json.get("error").asText() : "Login failed";
            throw new IOException("Z-Library login failed: " + errorMsg);
        }

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
     * Log in with stored remix tokens (no actual API call, just set cookies).
     */
    public void loginWithToken(String remixUserId, String remixUserKey) {
        cookies.put("remix_userid", remixUserId);
        cookies.put("remix_userkey", remixUserKey);
    }

    /**
     * Check if the client is logged in (has session cookies).
     */
    public boolean isLoggedIn() {
        return cookies.containsKey("remix_userid") && cookies.containsKey("remix_userkey");
    }

    /**
     * Search for books.
     */
    public SearchResult search(String query, Map<String, Object> options) throws IOException {
        FormBody.Builder formBuilder = new FormBody.Builder();
        formBuilder.add("message", query != null ? query : "");

        if (options != null) {
            if (options.containsKey("yearFrom")) formBuilder.add("yearFrom", String.valueOf(options.get("yearFrom")));
            if (options.containsKey("yearTo")) formBuilder.add("yearTo", String.valueOf(options.get("yearTo")));
            if (options.containsKey("languages")) formBuilder.add("languages", (String) options.get("languages"));
            if (options.containsKey("extensions")) formBuilder.add("extensions", (String) options.get("extensions"));
            if (options.containsKey("order")) formBuilder.add("order", (String) options.get("order"));
            if (options.containsKey("page")) formBuilder.add("page", String.valueOf(options.get("page")));
            if (options.containsKey("limit")) formBuilder.add("limit", String.valueOf(options.get("limit")));
        }

        Request request = baseFormRequest("/eapi/book/search", null)
                .post(formBuilder.build())
                .build();

        JsonNode json = execute(request);

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
     * Get book info by id and hash.
     */
    public JsonNode getBookInfo(Long bookId, String hash) throws IOException {
        Request request = baseRequest("/eapi/book/" + bookId + "/" + hash)
                .get()
                .build();
        return execute(request);
    }

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
     * Get user profile.
     */
    public JsonNode getProfile() throws IOException {
        Request request = baseRequest("/eapi/user/profile")
                .get()
                .build();
        return execute(request);
    }

    /**
     * Get downloads remaining for today.
     */
    public int getDownloadsLeft() {
        if (userInfo == null) return 0;
        return Math.max(0, userInfo.getDownloadsLimit() - userInfo.getDownloadsToday());
    }

    /**
     * Get most popular books.
     */
    public SearchResult getMostPopular() throws IOException {
        Request request = baseRequest("/eapi/book/most-popular")
                .get()
                .build();

        JsonNode json = execute(request);

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
     * Get stored cookies (for persistence).
     */
    public Map<String, String> getCookies() {
        return new HashMap<>(cookies);
    }

    /**
     * Get the stored user info.
     */
    public ZlibraryUserInfo getUserInfo() {
        return userInfo;
    }

    /**
     * Set stored user info.
     */
    public void setUserInfo(ZlibraryUserInfo userInfo) {
        this.userInfo = userInfo;
    }

    /**
     * Logout: clear cookies and user info.
     */
    public void logout() {
        cookies.clear();
        userInfo = null;
    }
}
