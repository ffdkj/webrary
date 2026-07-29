package com.webrary.service;

import com.webrary.dto.*;
import com.webrary.model.User;
import com.webrary.model.UserZlibrary;
import com.webrary.repository.UserZlibraryRepository;
import com.webrary.zlibrary.ZlibraryApiClient;
import jakarta.servlet.http.HttpSession;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.Map;

/**
 * Z-Library 集成服务 — 管理 Z-Library API 客户端生命周期、自动登录、搜索、下载等操作。
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ZlibraryService {

    private final UserZlibraryRepository userZlibraryRepository;
    private final AuthService authService;

    // Session 中存储 ZlibraryApiClient 的属性名
    private static final String CLIENT_ATTR = "zlibClient";

    /**
     * 获取当前用户的 ZlibraryApiClient 实例。
     * 优先从 Session 中获取已登录的客户端；若无则从数据库读取凭据自动登录。
     * 自动登录顺序：先尝试 token（快速），失败则尝试邮箱密码。
     */
    private ZlibraryApiClient getClient(HttpSession session) {
        // 从 Session 中获取缓存的客户端
        ZlibraryApiClient client = (ZlibraryApiClient) session.getAttribute(CLIENT_ATTR);
        if (client != null && client.isLoggedIn()) {
            return client;
        }

        User currentUser = authService.getCurrentUserEntity(session);
        // 未登录 Web 用户则使用默认域名创建客户端（无凭据）
        if (currentUser == null) {
            client = new ZlibraryApiClient("fuckfbi.ru");
            session.setAttribute(CLIENT_ATTR, client);
            return client;
        }

        // 从数据库查找用户绑定的 Z-Library 凭据
        UserZlibrary uz = userZlibraryRepository.findByUser(currentUser).orElse(null);
        if (uz == null) {
            client = new ZlibraryApiClient("fuckfbi.ru");
            session.setAttribute(CLIENT_ATTR, client);
            return client;
        }

        // 使用用户配置的域名和代理创建客户端
        String domain = uz.getDomain() != null && !uz.getDomain().isBlank() ? uz.getDomain() : "fuckfbi.ru";
        client = new ZlibraryApiClient(domain, uz.getProxyHost(), uz.getProxyPort());

        // 优先使用 token 登录（快速，无需网络调用，Z-Library 密钥长期有效）
        // Try token first — fast, no network call, Z-Library keys are long-lived
        if (uz.getRemixUserId() != null && uz.getRemixUserkey() != null) {
            client.loginWithToken(uz.getRemixUserId(), uz.getRemixUserkey());
            log.info("Auto-login to Z-Library with stored token for user {}", currentUser.getId());
        }

        // 如果 token 无效（未设置 Cookie）或无 token，尝试邮箱密码登录
        // If token didn't work (no cookies set) or no token stored, try email+password
        if (!client.isLoggedIn() && uz.getZlibraryEmail() != null && !uz.getZlibraryEmail().isBlank()
                && uz.getZlibraryPassword() != null && !uz.getZlibraryPassword().isBlank()) {
            try {
                client.login(uz.getZlibraryEmail(), uz.getZlibraryPassword());
                log.info("Auto-login to Z-Library with credentials for user {}", currentUser.getId());
            } catch (Exception e) {
                log.warn("Auto-login to Z-Library failed: {}", e.getMessage());
            }
        }

        session.setAttribute(CLIENT_ATTR, client);
        return client;
    }

    /**
     * 检查当前用户是否已登录 Z-Library。
     * 调用 getClient 会触发自动登录流程。
     */
    public boolean isLoggedIn(HttpSession session) {
        ZlibraryApiClient client = getClient(session); // triggers auto-login from stored key
        return client.isLoggedIn();
    }

    /**
     * 使用邮箱密码登录 Z-Library，并将凭据持久化到数据库。
     */
    public ZlibraryUserInfo login(HttpSession session, String email, String password, String domain,
                                   String proxyHost, Integer proxyPort) throws IOException {
        ZlibraryApiClient client;
        String effectiveDomain = domain != null && !domain.isBlank() ? domain : "fuckfbi.ru";
        client = new ZlibraryApiClient(effectiveDomain, proxyHost, proxyPort);

        ZlibraryUserInfo userInfo = client.login(email, password);
        session.setAttribute(CLIENT_ATTR, client);

        // 将 Z-Library 凭据持久化到数据库，下次可自动登录
        // Persist to DB
        User currentUser = authService.getCurrentUserEntity(session);
        if (currentUser != null) {
            UserZlibrary uz = userZlibraryRepository.findByUser(currentUser).orElse(null);
            if (uz == null) {
                uz = UserZlibrary.builder().user(currentUser).build();
            }
            uz.setZlibraryEmail(email);
            uz.setZlibraryPassword(password);
            uz.setDomain(effectiveDomain);
            uz.setProxyHost(proxyHost);
            uz.setProxyPort(proxyPort);
            uz.setRemixUserId(String.valueOf(userInfo.getId()));
            uz.setRemixUserkey(userInfo.getRemixUserkey());
            userZlibraryRepository.save(uz);
        }

        return userInfo;
    }

    /**
     * 登出 Z-Library，清除 Session 中的客户端和 Cookie。
     */
    public void logout(HttpSession session) {
        ZlibraryApiClient client = (ZlibraryApiClient) session.getAttribute(CLIENT_ATTR);
        if (client != null) {
            client.logout();
        }
        session.removeAttribute(CLIENT_ATTR);
    }

    /**
     * 搜索 Z-Library 书籍。
     */
    public SearchResult search(HttpSession session, SearchRequest request) throws IOException {
        ZlibraryApiClient client = getClient(session);
        ensureLoggedIn(client);

        // 构建搜索选项
        Map<String, Object> options = new java.util.HashMap<>();
        if (request.getYearFrom() != null) options.put("yearFrom", request.getYearFrom());
        if (request.getYearTo() != null) options.put("yearTo", request.getYearTo());
        if (request.getLanguages() != null) options.put("languages", request.getLanguages());
        if (request.getExtensions() != null && !request.getExtensions().isEmpty()) options.put("extensions", request.getExtensions());
        if (request.getOrder() != null) options.put("order", request.getOrder());
        options.put("page", request.getPage() != null ? request.getPage() : 1);
        options.put("limit", request.getLimit() != null ? request.getLimit() : 10);

        return client.search(request.getMessage(), options);
    }

    /**
     * 获取 Z-Library 书籍详细信息。
     */
    public Object getBookInfo(HttpSession session, Long bookId, String hash) throws IOException {
        ZlibraryApiClient client = getClient(session);
        ensureLoggedIn(client);
        return client.getBookInfo(bookId, hash);
    }

    /**
     * 获取 Z-Library 书籍的下载链接信息。
     */
    public DownloadInfo getDownloadLink(HttpSession session, Long bookId, String hash) throws IOException {
        ZlibraryApiClient client = getClient(session);
        ensureLoggedIn(client);
        return client.getDownloadLink(bookId, hash);
    }

    /**
     * 从 Z-Library 下载书籍文件内容。
     */
    public byte[] downloadBook(HttpSession session, Long bookId, String hash) throws IOException {
        ZlibraryApiClient client = getClient(session);
        ensureLoggedIn(client);
        return client.downloadBook(bookId, hash);
    }

    /**
     * 带进度回调的下载书籍。
     */
    public byte[] downloadBookWithProgress(HttpSession session, Long bookId, String hash,
                                           java.util.function.Consumer<Long> onProgress) throws IOException {
        ZlibraryApiClient client = getClient(session);
        ensureLoggedIn(client);
        return client.downloadBookWithProgress(bookId, hash, onProgress);
    }

    /**
     * 获取 Z-Library 用户个人信息。
     */
    public ZlibraryUserInfo getProfile(HttpSession session) throws IOException {
        ZlibraryApiClient client = getClient(session);
        ensureLoggedIn(client);
        client.getProfile();
        return client.getUserInfo();
    }

    /**
     * 获取 Z-Library 最受欢迎书籍列表。
     */
    public SearchResult getMostPopular(HttpSession session) throws IOException {
        ZlibraryApiClient client = getClient(session);
        ensureLoggedIn(client);
        return client.getMostPopular();
    }

    /**
     * 校验客户端已登录，否则抛出异常。
     */
    private void ensureLoggedIn(ZlibraryApiClient client) {
        if (!client.isLoggedIn()) {
            throw new RuntimeException("Not logged in to Z-Library");
        }
    }
}
