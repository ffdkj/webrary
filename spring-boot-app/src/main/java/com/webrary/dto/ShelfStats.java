package com.webrary.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ShelfStats {
    private int bookCount;
    private int unreadCount;
    private int finishedCount;
}
