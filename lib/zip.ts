import zlib from 'zlib';

// 极简 ZIP 打包器（DEFLATE，零外部依赖）。
// 支持 UTF-8 文件名，足以把多场直播的明细 CSV 按文件夹打包下载。

let _crcTable: number[] | null = null;
function crc32(buf: Buffer): number {
  if (!_crcTable) {
    _crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      _crcTable[n] = c >>> 0;
    }
  }
  const table = _crcTable;
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++)
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipFile {
  name: string; // 可含 "/"，即子文件夹
  data: string; // 文本（按 UTF-8 编码）
}

export function zipStore(files: ZipFile[]): Buffer {
  const enc = (s: string) => Buffer.from(s, 'utf8');
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = enc(f.name);
    const raw = enc(f.data);
    const comp = zlib.deflateRawSync(raw);
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // 本地文件头签名
    local.writeUInt16LE(20, 4); // 版本
    local.writeUInt16LE(0x0800, 6); // 通用标志：UTF-8 文件名
    local.writeUInt16LE(8, 8); // 压缩方式：DEFLATE
    local.writeUInt16LE(0, 10); // 修改时间
    local.writeUInt16LE(0, 12); // 修改日期
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); // 压缩后大小
    local.writeUInt32LE(raw.length, 22); // 未压缩大小
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // 扩展字段长度
    chunks.push(local, nameBuf, comp);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); // 中央目录头签名
    cen.writeUInt16LE(20, 4); // 版本由
    cen.writeUInt16LE(20, 6); // 版本解
    cen.writeUInt16LE(0x0800, 8); // UTF-8 标志
    cen.writeUInt16LE(8, 10); // 压缩方式
    cen.writeUInt16LE(0, 12); // 时间
    cen.writeUInt16LE(0, 14); // 日期
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30); // 扩展
    cen.writeUInt16LE(0, 32); // 注释
    cen.writeUInt16LE(0, 34); // 磁盘号
    cen.writeUInt16LE(0, 36); // 内部属性
    cen.writeUInt32LE(0, 38); // 外部属性
    cen.writeUInt32LE(offset, 42); // 本地头偏移
    central.push(cen, nameBuf);

    offset += local.length + nameBuf.length + comp.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // 结束签名
  end.writeUInt16LE(0, 4); // 磁盘数
  end.writeUInt16LE(0, 6); // 中央目录起始磁盘
  end.writeUInt16LE(files.length, 8); // 本磁盘文件数
  end.writeUInt16LE(files.length, 10); // 总文件数
  end.writeUInt32LE(centralBuf.length, 12); // 中央目录大小
  end.writeUInt32LE(offset, 16); // 中央目录偏移
  end.writeUInt16LE(0, 20); // 注释长度

  return Buffer.concat([...chunks, centralBuf, end]);
}
