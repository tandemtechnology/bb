CREATE TABLE IF NOT EXISTS `project_env_vars` (
	`project_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text,
	`secret` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `project_env_vars_project_key_idx` ON `project_env_vars` (`project_id`,`key`);
