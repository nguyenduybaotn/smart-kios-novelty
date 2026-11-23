import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Image,
  Input,
  Modal,
  Row,
  Segmented,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  message
} from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  ExclamationCircleOutlined,
  EyeOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  RollbackOutlined,
  SearchOutlined,
  UserOutlined,
  VideoCameraOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import isBetween from 'dayjs/plugin/isBetween';
import { API_BASE, cleanupOldVideos, getSessions, getSnapshots } from '../services/api';

dayjs.extend(isBetween);

const formatDateTime = value => (value && dayjs(value).isValid() ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-');
const formatTimeOnly = value => (value && dayjs(value).isValid() ? dayjs(value).format('HH:mm') : '');
const formatDateOnly = value => (value && dayjs(value).isValid() ? dayjs(value).format('DD/MM/YYYY') : '-');

const firstTrackingNumber = row =>
  String(row?.ReturnTrackingNumber || row?.OrderReturnTrackingNumber || row?.TrackingNumbers || row?.OrderCode || row?.SessionId || 'video')
    .split(',')
    .map(value => value.trim())
    .find(Boolean) || 'video';

const videoDownloadUrl = (row, fileName, source = 'main') => {
  const returnTracking = row?.ReturnTrackingNumber || row?.OrderReturnTrackingNumber;
  const returnParam = returnTracking ? `&returnTrackingNumber=${encodeURIComponent(returnTracking)}` : '';
  return `${API_BASE}/videos/download/${encodeURIComponent(fileName)}?trackingNumber=${encodeURIComponent(firstTrackingNumber(row))}&source=${source}${returnParam}`;
};

export default function SessionsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deletingOld, setDeletingOld] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sessionTypeFilter, setSessionTypeFilter] = useState('ALL'); // 'ALL' | 'PACKING' | 'RETURN'
  const [dateRange, setDateRange] = useState(null); // [dayjs, dayjs] or null

  // Snapshots modal
  const [snapOpen, setSnapOpen] = useState(false);
  const [snapRows, setSnapRows] = useState([]);
  const [snapTitle, setSnapTitle] = useState('');
  const [snapLoading, setSnapLoading] = useState(false);

  // Video modal
  const [videoModal, setVideoModal] = useState({
    open: false,
    title: '',
    mainUrl: '',
    mainDownloadUrl: '',
    camera2Url: '',
    camera2DownloadUrl: '',
    activeTab: 'main',
    row: null
  });

  const fetchSessions = () => {
    setLoading(true);
    getSessions(searchQuery)
      .then(data => setRows(data || []))
      .catch(err => {
        message.error(err.response?.data?.message || 'Không thể tải lịch sử video');
      })
      .finally(() => setLoading(false));
  };

  const handleCleanupOldVideos = () => {
    Modal.confirm({
      title: 'Xác nhận xóa video lưu trữ trên 90 ngày?',
      icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
      content: (
        <div style={{ marginTop: 8 }}>
          <p>Hệ thống sẽ quét và <b>xóa vĩnh viễn toàn bộ các file video</b> (Camera chính & Camera 2) có ngày ghi hình <b>trên 90 ngày</b> so với hiện tại để giải phóng dung lượng ổ đĩa.</p>
          <p style={{ color: '#888', fontSize: 13, marginBottom: 0 }}>
            ℹ️ <i>Lưu ý: Lịch sử đơn hàng, thông tin phiên đóng gói và ảnh chụp (snapshots) vẫn được lưu giữ nguyên vẹn trên hệ thống.</i>
          </p>
        </div>
      ),
      okText: 'Xác nhận xóa',
      okType: 'danger',
      cancelText: 'Hủy bỏ',
      async onOk() {
        setDeletingOld(true);
        try {
          const res = await cleanupOldVideos(90);
          if (res.deletedFilesCount > 0) {
            message.success(`Đã xóa thành công ${res.deletedFilesCount} file video (> 90 ngày), giải phóng ${res.freedMB} MB dung lượng ổ đĩa!`);
          } else {
            message.info('Không có file video nào cũ hơn 90 ngày cần xóa.');
          }
          fetchSessions();
        } catch (err) {
          message.error(err.response?.data?.message || err.message || 'Không thể dọn dẹp video cũ');
        } finally {
          setDeletingOld(false);
        }
      }
    });
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchSessions();
    }, 280);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Bộ lọc kết hợp ở frontend (Loại phiên + Khoảng ngày)
  const filteredRows = useMemo(() => {
    return rows.filter(r => {
      // 1. Lọc theo loại phiên
      const type = String(r.SessionType || 'PACKING').toUpperCase();
      if (sessionTypeFilter === 'PACKING' && type !== 'PACKING') return false;
      if (sessionTypeFilter === 'RETURN' && type !== 'RETURN') return false;

      // 2. Lọc theo khoảng ngày (nếu có chọn)
      if (dateRange && dateRange[0] && dateRange[1]) {
        const rowDate = dayjs(r.CompletedAt || r.StartedAt);
        if (!rowDate.isValid()) return false;
        const start = dateRange[0].startOf('day');
        const end = dateRange[1].endOf('day');
        if (rowDate.isBefore(start) || rowDate.isAfter(end)) return false;
      }

      return true;
    });
  }, [rows, sessionTypeFilter, dateRange]);

  // Thống kê nhanh
  const stats = useMemo(() => {
    const total = rows.length;
    const packingCount = rows.filter(r => String(r.SessionType || 'PACKING').toUpperCase() === 'PACKING').length;
    const returnCount = rows.filter(r => String(r.SessionType || 'PACKING').toUpperCase() === 'RETURN').length;
    const totalBytes = rows.reduce((sum, r) => sum + Number(r.VideoSizeBytes || 0) + Number(r.VideoSizeBytes2 || 0), 0);
    const totalMB = (totalBytes / 1024 / 1024).toFixed(1);
    return { total, packingCount, returnCount, totalMB };
  }, [rows]);

  async function showSnapshots(row) {
    setSnapTitle(`Hình ảnh bằng chứng - Đơn ${row.OrderCode}`);
    setSnapLoading(true);
    setSnapOpen(true);
    try {
      const data = await getSnapshots(row.SessionId);
      setSnapRows(data || []);
    } catch {
      message.error('Không thể tải danh sách hình ảnh');
      setSnapRows([]);
    } finally {
      setSnapLoading(false);
    }
  }

  function openVideoModal(row, defaultTab = 'main') {
    const isReturn = String(row.SessionType || '').toUpperCase() === 'RETURN';
    const typeLabel = isReturn ? 'HÀNG HOÀN' : 'ĐÓNG GÓI';
    const mainFile = row.VideoFileName;
    const cam2File = row.VideoFileName2;

    setVideoModal({
      open: true,
      title: `[${typeLabel}] Đơn ${row.OrderCode} • ${row.TrackingNumbers || row.ReturnTrackingNumber || ''}`,
      mainUrl: mainFile ? `${API_BASE}/videos/${encodeURIComponent(mainFile)}` : '',
      mainDownloadUrl: mainFile ? videoDownloadUrl(row, mainFile, 'main') : '',
      camera2Url: cam2File ? `${API_BASE}/videos/${encodeURIComponent(cam2File)}` : '',
      camera2DownloadUrl: cam2File ? videoDownloadUrl(row, cam2File, 'camera2') : '',
      activeTab: defaultTab,
      row
    });
  }

  return (
    <div className="sessionsPageContainer">
      {/* 1. Thanh KPI tóm tắt */}
      <Row gutter={[14, 14]} className="sessionsKpiRow">
        <Col xs={12} sm={6}>
          <Card className="glass kpiCard">
            <Statistic
              title="Tổng số clip"
              value={stats.total}
              prefix={<VideoCameraOutlined style={{ color: '#00e5ff' }} />}
              suffix="video"
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card className="glass kpiCard">
            <Statistic
              title="Đóng gói xuất hàng"
              value={stats.packingCount}
              prefix={<CheckCircleOutlined style={{ color: '#13a65f' }} />}
              styles={{ content: { color: '#74f7ff' } }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card className="glass kpiCard">
            <Statistic
              title="Hàng hoàn trả sàn"
              value={stats.returnCount}
              prefix={<RollbackOutlined style={{ color: '#fa8c16' }} />}
              styles={{ content: { color: '#ff9c6e' } }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card className="glass kpiCard">
            <Statistic
              title="Dung lượng đã lưu"
              value={stats.totalMB}
              prefix={<DownloadOutlined style={{ color: '#b58cff' }} />}
              suffix="MB"
            />
          </Card>
        </Col>
      </Row>

      {/* 2. Thẻ danh sách video chính */}
      <Card
        className="glass sessionsMainCard"
        title={
          <div className="sessionsCardHeader">
            <div className="sessionsHeaderTitle">
              <VideoCameraOutlined style={{ color: '#00e5ff', fontSize: 20 }} />
              <span>Lịch sử Video Đóng gói & Hàng hoàn</span>
              <Tag color="cyan" style={{ borderRadius: 10, padding: '2px 8px' }}>
                {filteredRows.length} video
              </Tag>
            </div>
          </div>
        }
        extra={
          <Space>
            <Button
              danger
              icon={<DeleteOutlined />}
              loading={deletingOld}
              onClick={handleCleanupOldVideos}
              style={{ borderRadius: 6 }}
            >
              Xóa video &gt; 90 ngày
            </Button>
            <Button icon={<ReloadOutlined />} onClick={fetchSessions} loading={loading}>
              Làm mới
            </Button>
          </Space>
        }
      >
        {/* Bộ lọc thanh công cụ: Segmented + RangePicker + Search Input */}
        <div className="sessionsToolbar">
          <div className="toolbarLeft">
            <Segmented
              className="typeSegmented"
              value={sessionTypeFilter}
              onChange={setSessionTypeFilter}
              options={[
                { label: 'Tất cả', value: 'ALL' },
                {
                  label: (
                    <span>
                      <CheckCircleOutlined style={{ marginRight: 4, color: '#13a65f' }} />
                      Đóng gói ({stats.packingCount})
                    </span>
                  ),
                  value: 'PACKING'
                },
                {
                  label: (
                    <span>
                      <RollbackOutlined style={{ marginRight: 4, color: '#fa8c16' }} />
                      Hàng hoàn ({stats.returnCount})
                    </span>
                  ),
                  value: 'RETURN'
                }
              ]}
            />

            <DatePicker.RangePicker
              className="sessionDateRange"
              value={dateRange}
              onChange={setDateRange}
              format="DD/MM/YYYY"
              placeholder={['Từ ngày', 'Đến ngày']}
              allowClear
            />
          </div>

          <div className="toolbarRight">
            <Input
              allowClear
              prefix={<SearchOutlined style={{ color: '#0067b1' }} />}
              className="searchBox sessionsSearchInput"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Tìm mã đơn, vận đơn gốc, vận đơn hoàn, khách hàng, SĐT..."
            />
          </div>
        </div>

        {/* Bảng dữ liệu video */}
        <Table
          rowKey="SessionId"
          dataSource={filteredRows}
          loading={loading}
          scroll={{ x: 1380 }}
          pagination={{ pageSize: 15, showTotal: (total, range) => `${range[0]}-${range[1]} của ${total} video` }}
          className="sessionsTable"
          locale={{ emptyText: <Empty description="Chưa có video phù hợp" /> }}
          columns={[
            // Cột 1: Thumbnail ảnh snapshot
            {
              title: 'Ảnh',
              dataIndex: 'FirstSnapshotFileName',
              width: 78,
              align: 'center',
              render: (v, r) =>
                v ? (
                  <Tooltip title="Bấm để xem danh sách ảnh chụp">
                    <img
                      className="historyAvatar thumbnailImage"
                      src={`${API_BASE}/snapshots/${v}`}
                      alt="snap"
                      onClick={() => showSnapshots(r)}
                    />
                  </Tooltip>
                ) : (
                  <div className="historyAvatar darkEmptyAvatar">
                    <PictureOutlined style={{ color: 'rgba(255,255,255,0.25)', fontSize: 18 }} />
                  </div>
                )
            },

            // Cột 2: Phân loại phiên
            {
              title: 'Loại',
              dataIndex: 'SessionType',
              width: 115,
              align: 'center',
              render: v =>
                String(v || '').toUpperCase() === 'RETURN' ? (
                  <Tag color="volcano" className="sessionTypeTag returnTag">
                    <RollbackOutlined /> HÀNG HOÀN
                  </Tag>
                ) : (
                  <Tag color="cyan" className="sessionTypeTag packingTag">
                    <CheckCircleOutlined /> ĐÓNG GÓI
                  </Tag>
                )
            },

            // Cột 3: Đơn hàng & Mã vận đơn
            {
              title: 'Mã đơn & Vận đơn',
              dataIndex: 'OrderCode',
              width: 230,
              render: (code, r) => {
                const isReturn = String(r.SessionType || '').toUpperCase() === 'RETURN';
                const returnTracking = r.ReturnTrackingNumber || r.OrderReturnTrackingNumber;
                return (
                  <div className="orderCodeCell">
                    <div className="codeTitle">
                      <QrcodeOutlined style={{ color: isReturn ? '#fa8c16' : '#00e5ff', marginRight: 5 }} />
                      <span className="mono boldText">{code}</span>
                    </div>
                    {returnTracking && (
                      <div className="subTrackingRow">
                        <Tag color="orange" className="returnTrackingPill">
                          Hoàn: <b>{returnTracking}</b>
                        </Tag>
                      </div>
                    )}
                    {r.TrackingNumbers && (
                      <div className="origTrackingRow">
                        <span className="labelGray">Vận đơn:</span> <span className="mono">{r.TrackingNumbers}</span>
                      </div>
                    )}
                  </div>
                );
              }
            },

            // Cột 4: Clip Video & Hành động phát / tải
            {
              title: 'Xem & Tải Clip Video',
              width: 250,
              render: (_, r) => {
                const hasMain = Boolean(r.VideoFileName);
                const hasCam2 = Boolean(r.VideoFileName2);
                if (!hasMain && !hasCam2) return <span className="emptyDash">-</span>;

                const durationSec =
                  r.DurationSeconds != null && !isNaN(r.DurationSeconds) && Number(r.DurationSeconds) >= 0
                    ? Math.round(Number(r.DurationSeconds))
                    : r.CompletedAt && r.StartedAt && dayjs(r.CompletedAt).isValid() && dayjs(r.StartedAt).isValid()
                    ? Math.max(0, dayjs(r.CompletedAt).diff(dayjs(r.StartedAt), 'second'))
                    : null;

                const cam2MB = r.VideoSizeBytes2 ? (r.VideoSizeBytes2 / 1024 / 1024).toFixed(1) : null;

                return (
                  <div className="videoActionCell">
                    {/* Hàng 1: Video ghép chính */}
                    {hasMain && (
                      <div className="videoRowItem">
                        <Button
                          size="small"
                          type="primary"
                          className="playMainBtn"
                          icon={<PlayCircleOutlined />}
                          onClick={() => openVideoModal(r, 'main')}
                        >
                          Xem clip {durationSec != null ? `(${durationSec}s)` : ''}
                        </Button>
                        <Tooltip title="Tải video ghép chính">
                          <a className="videoDownloadIconBtn" href={videoDownloadUrl(r, r.VideoFileName, 'main')}>
                            <DownloadOutlined />
                          </a>
                        </Tooltip>
                      </div>
                    )}

                    {/* Hàng 2: Camera 2 gốc (nếu có) */}
                    {hasCam2 && (
                      <div className="videoRowItem subCamRow">
                        <Button
                          size="small"
                          className="playSubBtn"
                          icon={<VideoCameraOutlined />}
                          onClick={() => openVideoModal(r, 'camera2')}
                        >
                          Cam 2 gốc {cam2MB ? `(${cam2MB} MB)` : ''}
                        </Button>
                        <Tooltip title="Tải video gốc Camera 2">
                          <a className="videoDownloadIconBtn subDlBtn" href={videoDownloadUrl(r, r.VideoFileName2, 'camera2')}>
                            <DownloadOutlined />
                          </a>
                        </Tooltip>
                      </div>
                    )}
                  </div>
                );
              }
            },

            // Cột 5: Khách hàng & SĐT
            {
              title: 'Khách hàng',
              width: 200,
              render: (_, r) => {
                const name = r.CustomerName || r.OrderCustomerName;
                const phone = r.CustomerPhone || r.OrderCustomerPhone;
                return (
                  <div className="customerCell">
                    <div className="customerName">{name || '-'}</div>
                    {phone && <div className="customerPhone">{phone}</div>}
                    {r.Channel && <Tag color="blue" className="channelTag">{r.Channel}</Tag>}
                  </div>
                );
              }
            },

            // Cột 6: Nhân viên thực hiện
            {
              title: 'Nhân viên',
              dataIndex: 'OperatorName',
              width: 140,
              render: v => (
                <div className="operatorCell">
                  <UserOutlined style={{ color: '#74f7ff', marginRight: 6 }} />
                  <span>{v || '-'}</span>
                </div>
              )
            },

            // Cột 7: Thời gian
            {
              title: 'Thời gian',
              width: 160,
              render: (_, r) => {
                const date = r.CompletedAt || r.StartedAt;
                return (
                  <div className="timeCell">
                    <div className="dateText">{formatDateOnly(date)}</div>
                    <div className="timeText">
                      <ClockCircleOutlined style={{ marginRight: 4, color: '#8fa6b8' }} />
                      {formatTimeOnly(date)}
                    </div>
                  </div>
                );
              }
            },

            // Cột 8: Trạng thái
            {
              title: 'Trạng thái',
              dataIndex: 'Status',
              width: 120,
              align: 'center',
              render: v => {
                const s = String(v || '').toUpperCase();
                if (s === 'COMPLETED') return <Tag color="green" className="statusTag">Hoàn tất</Tag>;
                if (s === 'FAILED') return <Tag color="red" className="statusTag">Lỗi</Tag>;
                if (s.includes('RECORDING')) return <Tag color="processing" className="statusTag">Đang quay</Tag>;
                if (s === 'PAUSED') return <Tag color="warning" className="statusTag">Tạm dừng</Tag>;
                return <Tag className="statusTag">{v}</Tag>;
              }
            },

            // Cột 9: Thao tác ảnh snapshot
            {
              title: 'Hình ảnh',
              width: 120,
              align: 'center',
              render: (_, r) => (
                <Button
                  size="small"
                  icon={<PictureOutlined />}
                  className="viewSnapshotsBtn"
                  onClick={() => showSnapshots(r)}
                >
                  Xem hình
                </Button>
              )
            }
          ]}
        />
      </Card>

      {/* 3. Modal xem video chuyên nghiệp */}
      <Modal
        open={videoModal.open}
        onCancel={() => setVideoModal(prev => ({ ...prev, open: false }))}
        footer={[
          <Button
            key="tab"
            href={videoModal.activeTab === 'main' ? videoModal.mainUrl : videoModal.camera2Url}
            target="_blank"
            rel="noreferrer"
          >
            Mở tab mới
          </Button>,
          (videoModal.activeTab === 'main' ? videoModal.mainDownloadUrl : videoModal.camera2DownloadUrl) && (
            <Button
              key="dl"
              type="primary"
              icon={<DownloadOutlined />}
              href={videoModal.activeTab === 'main' ? videoModal.mainDownloadUrl : videoModal.camera2DownloadUrl}
            >
              Tải video về máy
            </Button>
          ),
          <Button key="close" onClick={() => setVideoModal(prev => ({ ...prev, open: false }))}>
            Đóng
          </Button>
        ]}
        width={940}
        destroyOnHidden
        title={
          <div className="videoModalTitle">
            <VideoCameraOutlined style={{ color: '#00e5ff', marginRight: 8 }} />
            <span>{videoModal.title}</span>
          </div>
        }
      >
        {/* Nút chuyển đổi nhanh giữa Video Ghép và Camera 2 gốc */}
        {videoModal.camera2Url && (
          <div className="videoTabSwitcher">
            <Segmented
              value={videoModal.activeTab}
              onChange={val => setVideoModal(prev => ({ ...prev, activeTab: val }))}
              options={[
                { label: 'Video Ghép Toàn Cảnh (PIP)', value: 'main' },
                { label: 'Camera 2 Chất Lượng Gốc', value: 'camera2' }
              ]}
            />
          </div>
        )}

        <div className="videoPlayerStage">
          <video
            key={videoModal.activeTab === 'main' ? videoModal.mainUrl : videoModal.camera2Url}
            controls
            autoPlay
            playsInline
            className="popupVideoPlayer"
            src={videoModal.activeTab === 'main' ? videoModal.mainUrl : videoModal.camera2Url}
          />
        </div>
      </Modal>

      {/* 4. Modal xem ảnh snapshot */}
      <Modal
        open={snapOpen}
        footer={<Button onClick={() => setSnapOpen(false)}>Đóng</Button>}
        onCancel={() => setSnapOpen(false)}
        width={960}
        title={
          <Space>
            <PictureOutlined style={{ color: '#fa8c16' }} />
            <span>{snapTitle}</span>
          </Space>
        }
      >
        {snapLoading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#9bc3d6' }}>Đang tải hình ảnh...</div>
        ) : snapRows.length === 0 ? (
          <Empty description="Phiên này chưa có hình ảnh chụp nào" />
        ) : (
          <div className="snapshotGallery">
            {snapRows.map(x => (
              <div className="snapshotCard" key={x.SnapshotId}>
                <Image src={`${API_BASE}${x.imageUrl}`} />
                <div className="snapMeta">
                  {formatDateTime(x.CapturedAt)} • {x.FileSizeBytes ? `${(x.FileSizeBytes / 1024).toFixed(0)} KB` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

