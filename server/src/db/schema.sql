IF DB_ID('VisionAIKiosk') IS NULL CREATE DATABASE VisionAIKiosk;
GO
USE VisionAIKiosk;
GO

IF OBJECT_ID('dbo.OrderItems','U') IS NOT NULL DROP TABLE dbo.OrderItems;
IF OBJECT_ID('dbo.PackingSnapshots','U') IS NOT NULL DROP TABLE dbo.PackingSnapshots;
IF OBJECT_ID('dbo.PackingSessions','U') IS NOT NULL DROP TABLE dbo.PackingSessions;
IF OBJECT_ID('dbo.Orders','U') IS NOT NULL DROP TABLE dbo.Orders;
IF OBJECT_ID('dbo.Products','U') IS NOT NULL DROP TABLE dbo.Products;
IF OBJECT_ID('dbo.Cameras','U') IS NOT NULL DROP TABLE dbo.Cameras;
IF OBJECT_ID('dbo.Users','U') IS NOT NULL DROP TABLE dbo.Users;
GO

CREATE TABLE dbo.Users (
  UserId INT IDENTITY(1,1) PRIMARY KEY,
  Username NVARCHAR(80) NOT NULL UNIQUE,
  PasswordHash NVARCHAR(255) NOT NULL,
  FullName NVARCHAR(255) NOT NULL,
  Role NVARCHAR(50) NOT NULL DEFAULT 'PACKER',
  Phone NVARCHAR(80) NULL,
  IsActive BIT NOT NULL DEFAULT 1,
  LastLoginAt DATETIME2 NULL,
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

CREATE TABLE dbo.Products (
  ProductId INT IDENTITY(1,1) PRIMARY KEY,
  SKU NVARCHAR(80) NOT NULL UNIQUE,
  Barcode NVARCHAR(120) NULL,
  ProductName NVARCHAR(255) NOT NULL,
  Category NVARCHAR(120) NULL,
  Price DECIMAL(18,2) NOT NULL DEFAULT 0,
  ImageUrl NVARCHAR(500) NULL,
  IsActive BIT NOT NULL DEFAULT 1,
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

CREATE TABLE dbo.Orders (
  OrderId INT IDENTITY(1,1) PRIMARY KEY,
  OrderCode NVARCHAR(120) NOT NULL UNIQUE,
  Id_Sapo BIGINT NULL,
  TrackingNumbers NVARCHAR(2000) NULL,
  ReturnTrackingNumber NVARCHAR(255) NULL,
  SapoSyncedAt DATETIME2 NULL,
  SapoSyncError NVARCHAR(2000) NULL,
  CustomerName NVARCHAR(255) NULL,
  Phone NVARCHAR(80) NULL,
  Address NVARCHAR(500) NULL,
  Channel NVARCHAR(100) NULL,
  Status NVARCHAR(50) NOT NULL DEFAULT 'NEW',
  Note NVARCHAR(1000) NULL,
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt DATETIME2 NULL
);
GO
CREATE UNIQUE INDEX UX_Orders_Id_Sapo ON dbo.Orders(Id_Sapo) WHERE Id_Sapo IS NOT NULL;
GO

CREATE TABLE dbo.OrderItems (
  OrderItemId INT IDENTITY(1,1) PRIMARY KEY,
  OrderId INT NOT NULL FOREIGN KEY REFERENCES dbo.Orders(OrderId) ON DELETE CASCADE,
  SKU NVARCHAR(80) NOT NULL,
  Barcode NVARCHAR(120) NULL,
  ProductName NVARCHAR(255) NOT NULL,
  QtyExpected INT NOT NULL DEFAULT 1,
  QtyPacked INT NOT NULL DEFAULT 0,
  UnitPrice DECIMAL(18,2) NOT NULL DEFAULT 0,
  Status NVARCHAR(50) NOT NULL DEFAULT 'PENDING'
);
GO

CREATE TABLE dbo.Cameras (
  CameraId INT IDENTITY(1,1) PRIMARY KEY,
  CameraCode NVARCHAR(80) NOT NULL UNIQUE,
  CameraName NVARCHAR(255) NOT NULL,
  ConnectionType NVARCHAR(30) NOT NULL DEFAULT 'RTSP',
  RtspUrl NVARCHAR(1000) NULL,
  DeviceHint NVARCHAR(255) NULL,
  IsDefault BIT NOT NULL DEFAULT 0,
  IsActive BIT NOT NULL DEFAULT 1,
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

CREATE TABLE dbo.PackingSessions (
  SessionId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  OrderId INT NOT NULL FOREIGN KEY REFERENCES dbo.Orders(OrderId),
  CameraId INT NULL FOREIGN KEY REFERENCES dbo.Cameras(CameraId),
  CameraId2 INT NULL FOREIGN KEY REFERENCES dbo.Cameras(CameraId),
  OperatorUserId INT NULL FOREIGN KEY REFERENCES dbo.Users(UserId),
  OrderCode NVARCHAR(120) NOT NULL,
  StartedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CompletedAt DATETIME2 NULL,
  Status NVARCHAR(50) NOT NULL DEFAULT 'RECORDING',
  VideoPath NVARCHAR(1000) NULL,
  VideoFileName NVARCHAR(255) NULL,
  VideoPath2 NVARCHAR(1000) NULL,
  VideoFileName2 NVARCHAR(255) NULL,
  VideoSizeBytes2 BIGINT NULL,
  CompositeMode NVARCHAR(40) NULL,
  SessionType NVARCHAR(30) NOT NULL DEFAULT 'PACKING',
  ReturnTrackingNumber NVARCHAR(255) NULL,
  ReturnReason NVARCHAR(500) NULL,
  VideoSizeBytes BIGINT NULL,
  DurationSeconds INT NULL,
  QrPayload NVARCHAR(500) NULL,
  OperatorName NVARCHAR(255) NULL,
  OperatorUsername NVARCHAR(80) NULL,
  CustomerName NVARCHAR(255) NULL,
  CustomerPhone NVARCHAR(80) NULL,
  Note NVARCHAR(1000) NULL
);
GO


CREATE TABLE dbo.PackingSnapshots (
  SnapshotId INT IDENTITY(1,1) PRIMARY KEY,
  SessionId UNIQUEIDENTIFIER NOT NULL FOREIGN KEY REFERENCES dbo.PackingSessions(SessionId) ON DELETE CASCADE,
  OrderId INT NOT NULL FOREIGN KEY REFERENCES dbo.Orders(OrderId),
  OrderCode NVARCHAR(120) NOT NULL,
  FileName NVARCHAR(255) NOT NULL,
  FilePath NVARCHAR(1000) NOT NULL,
  FileSizeBytes BIGINT NULL,
  CapturedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CapturedByUserId INT NULL FOREIGN KEY REFERENCES dbo.Users(UserId),
  CapturedByName NVARCHAR(255) NULL,
  Note NVARCHAR(1000) NULL
);
GO

INSERT INTO dbo.Users(Username, PasswordHash, FullName, Role, Phone) VALUES
('admin', 'plain:123456', N'Quản trị hệ thống', 'ADMIN', '0900000000'),
('packer01', 'plain:123456', N'Nhân viên đóng hàng 01', 'PACKER', '0900000001');

INSERT INTO dbo.Cameras(CameraCode, CameraName, ConnectionType, RtspUrl, DeviceHint, IsDefault) VALUES
('CAM_PACK_01', N'Bàn đóng gói 01 - RTSP', 'RTSP', 'rtsp://user:password@192.168.1.100:554/stream1', NULL, 1),
('CAM_DIRECT_01', N'Camera trực tiếp trên tablet/laptop', 'DIRECT', NULL, N'Browser camera / webcam / tablet camera', 0);

INSERT INTO dbo.Products(SKU, Barcode, ProductName, Category, Price) VALUES
('SKU-AO-001', '893000000001', N'Áo Polo Nam', N'Thời trang', 150000),
('SKU-QUAN-002', '893000000002', N'Quần Kaki', N'Thời trang', 220000),
('SKU-NON-003', '893000000003', N'Nón lưỡi trai', N'Phụ kiện', 80000);

INSERT INTO dbo.Orders(OrderCode, CustomerName, Phone, Address, Channel, Status) VALUES
('ORD-DEMO-001', N'Nguyễn Văn A', '0900000001', N'TP.HCM', 'TikTok Shop', 'NEW');
DECLARE @OID INT = SCOPE_IDENTITY();
INSERT INTO dbo.OrderItems(OrderId, SKU, Barcode, ProductName, QtyExpected, UnitPrice) VALUES
(@OID, 'SKU-AO-001', '893000000001', N'Áo Polo Nam', 1, 150000),
(@OID, 'SKU-QUAN-002', '893000000002', N'Quần Kaki', 1, 220000),
(@OID, 'SKU-NON-003', '893000000003', N'Nón lưỡi trai', 1, 80000);
GO
