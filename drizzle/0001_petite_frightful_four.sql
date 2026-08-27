CREATE TABLE `watchlist` (
	`user_id` integer NOT NULL,
	`fund_code` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `fund_code`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
