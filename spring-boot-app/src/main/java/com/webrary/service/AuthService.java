package com.webrary.service;

import com.webrary.dto.AuthRequest;
import com.webrary.dto.UserResponse;
import com.webrary.model.User;
import com.webrary.model.UserZlibrary;
import com.webrary.repository.UserRepository;
import com.webrary.repository.UserZlibraryRepository;
import jakarta.servlet.http.HttpSession;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Optional;

/**
 * 认证服务 — 处理用户注册、登录、登出、获取当前用户，以及密码加盐哈希。
 */
@Service
@RequiredArgsConstructor
public class AuthService {

    // Session 中存放用户 ID 的键名
    private static final String SESSION_USER_ID = "userId";

    private final UserRepository userRepository;
    private final UserZlibraryRepository userZlibraryRepository;

    /**
     * 用户注册 — 校验邮箱唯一性，加盐哈希密码，创建用户并写入会话。
     */
    @Transactional
    public UserResponse register(AuthRequest request, HttpSession session) {
        // 校验邮箱和密码不能为空
        if (request.getEmail() == null || request.getEmail().isBlank()
                || request.getPassword() == null || request.getPassword().isBlank()) {
            throw new IllegalArgumentException("邮箱和密码不能为空");
        }
        // 校验邮箱是否已注册
        if (userRepository.existsByEmail(request.getEmail().trim())) {
            throw new IllegalArgumentException("该邮箱已注册");
        }

        // 生成盐值并哈希密码
        String salt = generateSalt();
        String hash = hashPassword(request.getPassword(), salt);

        // 创建用户记录，密码字段存储格式：盐:哈希
        User user = User.builder()
                .email(request.getEmail().trim())
                .passwordHash(salt + ":" + hash)
                .build();
        user = userRepository.save(user);

        // 注册后自动登录：将用户 ID 写入 Session
        session.setAttribute(SESSION_USER_ID, user.getId());
        return buildUserResponse(user);
    }

    /**
     * 用户登录 — 校验邮箱和密码，成功后写入会话。
     */
    public UserResponse login(AuthRequest request, HttpSession session) {
        // 根据邮箱查找用户
        User user = userRepository.findByEmail(request.getEmail().trim())
                .orElseThrow(() -> new IllegalArgumentException("邮箱或密码错误"));

        // 拆分盐值和哈希，验证密码
        String[] parts = user.getPasswordHash().split(":", 2);
        if (parts.length != 2 || !hashPassword(request.getPassword(), parts[0]).equals(parts[1])) {
            throw new IllegalArgumentException("邮箱或密码错误");
        }

        // 登录成功，将用户 ID 写入 Session
        session.setAttribute(SESSION_USER_ID, user.getId());
        return buildUserResponse(user);
    }

    /**
     * 登出 — 清除会话属性并使会话失效。
     */
    public void logout(HttpSession session) {
        session.removeAttribute(SESSION_USER_ID);
        session.invalidate();
    }

    /**
     * 从 Session 获取当前登录用户信息。
     * @return 若未登录返回 null
     */
    public UserResponse getCurrentUser(HttpSession session) {
        Long userId = (Long) session.getAttribute(SESSION_USER_ID);
        if (userId == null) {
            return null;
        }
        return userRepository.findById(userId)
                .map(this::buildUserResponse)
                .orElse(null);
    }

    /**
     * 从 Session 获取当前登录用户的实体对象。
     * @return 若未登录返回 null
     */
    public User getCurrentUserEntity(HttpSession session) {
        Long userId = (Long) session.getAttribute(SESSION_USER_ID);
        if (userId == null) return null;
        return userRepository.findById(userId).orElse(null);
    }

    /**
     * 构建前端用户响应对象，包含 Z-Library 绑定信息。
     */
    private UserResponse buildUserResponse(User user) {
        Optional<UserZlibrary> zlib = userZlibraryRepository.findByUser(user);
        return UserResponse.builder()
                .id(user.getId())
                .email(user.getEmail())
                .zlibraryBound(zlib.isPresent() && zlib.get().getRemixUserkey() != null)
                .zlibraryEmail(zlib.map(UserZlibrary::getZlibraryEmail).orElse(null))
                .build();
    }

    /**
     * 生成 16 字节随机盐值，Base64 编码。
     */
    private String generateSalt() {
        byte[] salt = new byte[16];
        new SecureRandom().nextBytes(salt);
        return Base64.getEncoder().encodeToString(salt);
    }

    /**
     * 对密码进行加盐 SHA-256 哈希。
     * @param password 明文密码
     * @param salt 盐值
     * @return Base64 编码的哈希结果
     */
    private String hashPassword(String password, String salt) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            md.update(salt.getBytes());
            byte[] hash = md.digest(password.getBytes());
            return Base64.getEncoder().encodeToString(hash);
        } catch (Exception e) {
            throw new RuntimeException("Hash error", e);
        }
    }
}
