USE VisionAIKiosk;
GO
IF COL_LENGTH('dbo.Orders','Id_Sapo') IS NULL ALTER TABLE dbo.Orders ADD Id_Sapo BIGINT NULL;
IF COL_LENGTH('dbo.Orders','TrackingNumbers') IS NULL ALTER TABLE dbo.Orders ADD TrackingNumbers NVARCHAR(2000) NULL;
IF COL_LENGTH('dbo.Orders','SapoSyncedAt') IS NULL ALTER TABLE dbo.Orders ADD SapoSyncedAt DATETIME2 NULL;
IF COL_LENGTH('dbo.Orders','SapoSyncError') IS NULL ALTER TABLE dbo.Orders ADD SapoSyncError NVARCHAR(2000) NULL;
GO
-- Các bảng join được tạo idempotent bởi ensureSapoSchema trước lần đồng bộ đầu tiên.
