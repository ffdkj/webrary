package com.webrary.dto;

import lombok.Data;

/**
 * 统一API响应封装类，包含操作状态、消息和数据体。
 *
 * @param <T> 响应数据的类型
 */
@Data
public class ApiResponse<T> {
    /** 操作是否成功 */
    private boolean success;
    /** 提示消息（成功或错误信息） */
    private String message;
    /** 响应携带的数据体 */
    private T data;

    /**
     * 创建成功响应（仅携带数据）
     *
     * @param data 响应数据
     * @param <T>  数据类型
     * @return 成功状态的 ApiResponse
     */
    public static <T> ApiResponse<T> success(T data) {
        ApiResponse<T> response = new ApiResponse<>();
        response.setSuccess(true);
        response.setData(data);
        return response;
    }

    /**
     * 创建成功响应（携带消息和数据）
     *
     * @param message 提示消息
     * @param data    响应数据
     * @param <T>     数据类型
     * @return 成功状态的 ApiResponse
     */
    public static <T> ApiResponse<T> success(String message, T data) {
        ApiResponse<T> response = new ApiResponse<>();
        response.setSuccess(true);
        response.setMessage(message);
        response.setData(data);
        return response;
    }

    /**
     * 创建错误响应（携带错误消息）
     *
     * @param message 错误消息
     * @param <T>     数据类型
     * @return 失败状态的 ApiResponse
     */
    public static <T> ApiResponse<T> error(String message) {
        ApiResponse<T> response = new ApiResponse<>();
        response.setSuccess(false);
        response.setMessage(message);
        return response;
    }
}
