#!/usr/bin/env python3
"""PandaWiki 付费功能解锁 —— 本地样本逆向补丁 (arm64)

原理
----
官方 panda-wiki-api 的 pro 层用 LicenseData.edition (0开源/1专业/2企业/3商业) 派生：
  * echo context 键 "edition"            —— 各 handler 的 ValidateLimitation 门禁读取
  * echo context 键 "edition_limitation" —— domain.GetBaseEditionLimitation 读取（配额/开关）
把 edition 的取值钉死为 2（企业版）后：
  MaxKb / MaxNode / MaxAdmin = MaxInt64，所有 allow_* 开关为 true，
  统计天数、节点权限、SSO、MCP、API Token、敏感词、提示词等全部放行，
  /api/v1/license 也上报企业版，前端 VersionMask 遮罩随之消失。

定位方式
--------
不写死文件偏移：解析 Go pclntab 取函数入口，再按指令模式在函数体内定位打点。
同版本任意构建（含 amd64 偏移变化）都能命中；amd64 的等价指令见 README。

用法: python3 patch_license.py <原始二进制> <输出二进制>
"""
import sys, struct, os

# ---------- Go pclntab ----------
def find_pclntab(d):
    start = 0
    while True:
        i = d.find(b'\xf1\xff\xff\xff\x00\x00', start)
        if i < 0:
            return None
        if d[i+7] == 8 and d[i+6] in (1, 2, 4):
            nfunc, = struct.unpack_from('<Q', d, i+8)
            if 1000 < nfunc < 2_000_000:
                return i
        start = i + 1

def go_functions(d):
    base = find_pclntab(d)
    if base is None:
        raise SystemExit("未找到 Go pclntab（不是 Go 二进制？）")
    nfunc, nfiles, textStart, off_names, off_cu, off_file, off_pctab, off_pcln = \
        struct.unpack_from('<QQQQQQQQ', d, base+8)
    names, pcln = base+off_names, base+off_pcln
    out = {}
    for k in range(nfunc):
        entryoff, funcoff = struct.unpack_from('<II', d, pcln + k*8)
        fptr = pcln + funcoff
        nameoff, = struct.unpack_from('<i', d, fptr+4)
        end = d.index(b'\x00', names+nameoff)
        out[d[names+nameoff:end].decode('utf-8', 'replace')] = textStart + entryoff
    return out

# ---------- ELF ----------
def parse_elf(d):
    assert d[:4] == b'\x7fELF'
    e = '<' if d[5] == 1 else '>'
    phoff, = struct.unpack_from(e+'Q', d, 0x20)
    phentsize, phnum = struct.unpack_from(e+'HH', d, 0x36)
    segs = []
    for i in range(phnum):
        o = phoff + i*phentsize
        p_type, = struct.unpack_from(e+'I', d, o)
        p_offset, p_vaddr, _, p_filesz = struct.unpack_from(e+'QQQQ', d, o+8)
        if p_type == 1:
            segs.append((p_vaddr, p_offset, p_filesz))
    machine, = struct.unpack_from('<H', d, 0x12)
    return segs, {0xB7: 'aarch64', 0x3E: 'x86-64'}.get(machine, hex(machine))

def va2off(segs, va):
    for vaddr, off, filesz in segs:
        if vaddr <= va < vaddr + filesz:
            return off + (va - vaddr)
    raise KeyError(hex(va))

# ---------- arm64 打点 ----------
MOV_W0_2 = 0x52800040   # mov w0, #2
MOV_W2_2 = 0x52800042   # mov w2, #2

def patch_arm64(d, segs, funcs):
    hits = []

    def rd(va):
        o = va2off(segs, va)
        return struct.unpack_from('<I', d, o)[0]

    def wr(va, w):
        o = va2off(segs, va)
        struct.pack_into('<I', d, o, w)

    # 1) 中间件两个版本（原函数 + method-value 包装）：把 "edition" 取自 license 的 ldr wN,[xM,#0x30]
    targets = []
    for fn in ('github.com/chaitin/panda-wiki/pro/middleware.(*LicenseMiddleware).Middleware.func1',
               'github.com/chaitin/panda-wiki/pro/middleware.(*LicenseMiddleware).Middleware-fm.(*LicenseMiddleware).Middleware.func1'):
        if fn in funcs:
            targets.append((fn, funcs[fn]))
    for name, entry in targets:
        found = 0
        for k in range(0, 0x1000, 4):
            va = entry + k
            w = rd(va)
            # ldr w<Rt>, [x<Rn>, #0x30]  —— edition 字段（偏移 0x30）的两次读取
            if (w & 0xFFC00000) == 0xB9800000 and ((w >> 10) & 0xFFF) == 0x30 >> 2:
                rt = w & 0x1F
                mov = 0x52800040 | (rt << 0)
                if w == mov:                                # 已打过
                    hits.append((va, "已打补丁", name)); found += 1; continue
                if found >= 2:
                    continue
                wr(va, mov)
                hits.append((va, f"ldr w{rt},[x{(w>>5)&0x1F},#0x30] -> mov w{rt},#2", name)); found += 1
        if not found:
            hits.append((entry, "未在函数体内定位 edition 载入点（版本差异）", name))

    # 2) GetEditionLimitation：入口 cmp w0,#1 之后固定切入 edition==2 分支
    fn = 'github.com/chaitin/panda-wiki/pro/domain.GetEditionLimitation'
    if fn in funcs:
        entry = funcs[fn]
        for k in range(0, 0x40, 4):
            va = entry + k
            if rd(va) == 0x7100041F:                        # cmp w0, #1
                bva, b = va + 4, rd(va+4)
                if b == MOV_W0_2:
                    hits.append((va, "已打补丁", fn))
                else:
                    # 从 cmp 之后直接跳到 edition==2 分支（原 cmp w0,#2; b.eq 的目标）
                    tgt = None
                    for j in range(8, 0x60, 4):
                        w = rd(va+j)
                        if w == 0x7100081F:                 # cmp w0, #2
                            nxt = rd(va+j+4)
                            if (nxt & 0xFF000000) == 0x54000000:
                                imm19 = (nxt >> 5) & 0x7FFFF
                                if imm19 & (1 << 18): imm19 -= (1 << 19)
                                tgt = va + j + 4 + imm19*4
                            break
                    if tgt is None:
                        hits.append((entry, "未找到 edition==2 分支", fn)); break
                    wr(va, MOV_W0_2)
                    wr(va+4, 0x14000000 | (((tgt - (va+4)) >> 2) & 0x3FFFFFFF))
                    hits.append((va, f"cmp/b -> mov w0,#2 + b {tgt:#x}", fn))
                break
        else:
            hits.append((entry, "未定位 cmp w0,#1", fn))

    # 3) GetLicense 响应：edition 字段
    fn = 'github.com/chaitin/panda-wiki/pro/handler/v1.(*LicenseV1Handler).GetLicense'
    if fn in funcs:
        entry = funcs[fn]
        for k in range(0, 0x300, 4):
            va = entry + k
            if rd(va) == 0xB9803022:                        # ldr w2, [x1, #0x30]
                if rd(va+4) == MOV_W2_2:
                    hits.append((va, "已打补丁", fn))
                else:
                    wr(va, MOV_W2_2)
                    hits.append((va, f"{0xB9803022:#010x} -> {MOV_W2_2:#010x}", fn))
                break
        else:
            hits.append((entry, "未定位 edition 读取", fn))
    return hits

def main(src, dst):
    d = bytearray(open(src, 'rb').read())
    segs, arch = parse_elf(d)
    funcs = go_functions(d)
    print(f"[*] {os.path.basename(src)}  arch={arch}  函数数={len(funcs)}")
    if arch == 'aarch64':
        hits = patch_arm64(d, segs, funcs)
    else:
        raise SystemExit(f"当前仅实现 aarch64 打点；本样本是 {arch}")
    for va, what, fn in hits:
        print(f"    {va:#010x}  {what}\n                {fn}")
    open(dst, 'wb').write(d)
    os.chmod(dst, 0o755)
    print(f"[+] 写出 {dst}")

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
