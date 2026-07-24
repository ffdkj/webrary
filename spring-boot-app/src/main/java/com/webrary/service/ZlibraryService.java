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

@Service
@RequiredArgsConstructor
@Slf4j
public class ZlibraryService {

    private final UserZlibraryRepository userZlibraryRepository;
    private final AuthService authService;

    private static final String CLIENT_ATTR = "zlibClient";

    private ZlibraryApiClient getClient(HttpSession session) {
        ZlibraryApiClient client = (ZlibraryApiClient) session.getAttribute(CLIENT_ATTR);
        if (client != null && client.isLoggedIn()) {
            return client;
        }

        User currentUser = authService.getCurrentUserEntity(session);
        if (currentUser == null) {
            client = new ZlibraryApiClient("fuckfbi.ru");
            session.setAttribute(CLIENT_ATTR, client);
            return client;
        }

        UserZlibrary uz = userZlibraryRepository.findByUser(currentUser).orElse(null);
        if (uz == null) {
            client = new ZlibraryApiClient("fuckfbi.ru");
            session.setAttribute(CLIENT_ATTR, client);
            return client;
        }

        String domain = uz.getDomain() != null && !uz.getDomain().isBlank() ? uz.getDomain() : "fuckfbi.ru";
        client = new ZlibraryApiClient(domain, uz.getProxyHost(), uz.getProxyPort());

        // Try token first — fast, no network call, Z-Library keys are long-lived
        if (uz.getRemixUserId() != null && uz.getRemixUserkey() != null) {
            client.loginWithToken(uz.getRemixUserId(), uz.getRemixUserkey());
            log.info("Auto-login to Z-Library with stored token for user {}", currentUser.getId());
        }

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

    public boolean isLoggedIn(HttpSession session) {
        ZlibraryApiClient client = getClient(session); // triggers auto-login from stored key
        return client.isLoggedIn();
    }

    public ZlibraryUserInfo login(HttpSession session, String email, String password, String domain,
                                   String proxyHost, Integer proxyPort) throws IOException {
        ZlibraryApiClient client;
        String effectiveDomain = domain != null && !domain.isBlank() ? domain : "fuckfbi.ru";
        client = new ZlibraryApiClient(effectiveDomain, proxyHost, proxyPort);

        ZlibraryUserInfo userInfo = client.login(email, password);
        session.setAttribute(CLIENT_ATTR, client);

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

    public void logout(HttpSession session) {
        ZlibraryApiClient client = (ZlibraryApiClient) session.getAttribute(CLIENT_ATTR);
        if (client != null) {
            client.logout();
        }
        session.removeAttribute(CLIENT_ATTR);
    }

    public SearchResult search(HttpSession session, SearchRequest request) throws IOException {
        ZlibraryApiClient client = getClient(session);
        ensureLoggedIn(client);

        Map<String, Object> options = new java.util.HashMap<>();
        if (request.getYearFrom() != null) options.put("yearFrom", request.getYearFrom());
        if (request.getYearTo() != null) options.put("yearTo", request.getYearTo());
        if (request.getLanguages() != null) options.put("languages", request.getLanguages());
        if (request.getExtensions() != null) options.put("extensions", request.getExtensions());
        if (request.getOrder() != null) options.put("order", request.getOrder());
        options.put("page", request.getPage() != null ? request.getPage() : 1);
        options.put("limit", request.getLimit() != null ? request.getLimit() : 10);

        return client.search(request.getMessage(), options);
    }

    public Object getBookInfo(HttpSession session, Long bookId, String hash) throws IOException {
        ZlibraryApiClient client = getClient(session);
        ensureLoggedIn(client);
        return client.getBookInfo(bookId, hash);
    }

    public DownloadInfo getDownloadLink(HttpSession session, Long bookId, String hash) throws IOException {
        ZlibraryApiClient client = getClient(session);
        ensureLoggedIn(client);
        return client.getDownloadLink(bookId, hash);
    }

    public byte[] downloadBook(HttpSession session, Long bookId, String hash) throws IOException {
        ZlibraryApiClient client = getClient(session);
        ensureLoggedIn(client);
        return client.downloadBook(bookId, hash);
    }

    public ZlibraryUserInfo getProfile(HttpSession session) throws IOException {
        ZlibraryApiClient client = getClient(session);
        ensureLoggedIn(client);
        client.getProfile();
        return client.getUserInfo();
    }

    public SearchResult getMostPopular(HttpSession session) throws IOException {
        ZlibraryApiClient client = getClient(session);
        ensureLoggedIn(client);
        return client.getMostPopular();
    }

    private void ensureLoggedIn(ZlibraryApiClient client) {
        if (!client.isLoggedIn()) {
            throw new RuntimeException("Not logged in to Z-Library");
        }
    }
}
