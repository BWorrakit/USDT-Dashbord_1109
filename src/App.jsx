import { useEffect, useState } from "react";
import axios from "axios";
import { ethers } from "ethers";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  LabelList,
} from "recharts";

const CONTRACT = import.meta.env.VITE_CONTRACT;
const RPC = import.meta.env.VITE_JFIN_RPC;
const EXPLORER = import.meta.env.VITE_EXPLORER;

const PAGE_SIZE = 20;

export default function App() {
  const [tokenTxs, setTokenTxs] = useState([]);
  const [balance, setBalance] = useState("0");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [groupBy, setGroupBy] = useState("day");
  const [chartPage, setChartPage] = useState(1);

  async function fetchAllTokenTxs() {
    const allRows = [];
    let page = 1;
    const offset = 1000;

    while (true) {
      const url =
        `${EXPLORER}/api` +
        `?module=account` +
        `&action=tokentx` +
        `&address=${CONTRACT}` +
        `&page=${page}` +
        `&offset=${offset}` +
        `&sort=desc`;

      const res = await axios.get(url);
      const rows = Array.isArray(res.data.result) ? res.data.result : [];

      if (rows.length === 0) break;

      allRows.push(...rows);

      if (rows.length < offset) break;

      page++;
    }

    return allRows;
  }

  async function loadData() {
    setLoading(true);

    try {
      const provider = new ethers.JsonRpcProvider(RPC);
      const bal = await provider.getBalance(CONTRACT);
      setBalance(ethers.formatEther(bal));

      const tokenRows = await fetchAllTokenTxs();

      const normalized = tokenRows.map((tx) => ({
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        tokenName: tx.tokenName || "-",
        tokenSymbol: tx.tokenSymbol || "-",
        value:
          tx.value && tx.tokenDecimal
            ? Number(tx.value) / 10 ** Number(tx.tokenDecimal)
            : Number(tx.value || 0),
            fee, //
        time: new Date(Number(tx.timeStamp) * 1000).toLocaleString(),
        timestamp: Number(tx.timeStamp) * 1000,
      }));

      setTokenTxs(normalized);
    } catch (err) {
      console.error("LOAD ERROR:", err);
      alert("โหลดข้อมูลไม่สำเร็จ ดู error ใน Console");
    }

    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  const filteredTxs = tokenTxs.filter((tx) => {
    const fromContract = tx.from?.toLowerCase() === CONTRACT.toLowerCase();
    const toOtherAddress = tx.to?.toLowerCase() !== CONTRACT.toLowerCase();
    const isUSDT = tx.tokenSymbol?.toUpperCase() === "USDT";

    return fromContract && toOtherAddress && isUSDT;
  });

  const totalVolume = filteredTxs.reduce(
    (sum, tx) => sum + Number(tx.value || 0),
    0
  );

  const totalPages = Math.ceil(filteredTxs.length / PAGE_SIZE) || 1;

  const pagedTxs = filteredTxs.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

  function formatDate(d) {
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function dateKey(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function getMonday(timestamp) {
    const d = new Date(timestamp);
    const day = d.getDay();

    const monday = new Date(d);
    monday.setDate(d.getDate() - ((day + 6) % 7));
    monday.setHours(0, 0, 0, 0);

    return monday;
  }

  function getWeekRange(timestamp) {
    const monday = getMonday(timestamp);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    return {
      key: dateKey(monday),
      label: `${formatDate(monday)} - ${formatDate(sunday)}`,
    };
  }

  function getGroupData(timestamp, mode) {
    const d = new Date(timestamp);

    if (mode === "month") {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return {
        key,
        label: d.toLocaleDateString("en-US", {
          month: "short",
          year: "numeric",
        }),
      };
    }

    if (mode === "week") {
      return getWeekRange(timestamp);
    }

    const key = dateKey(d);
    return {
      key,
      label: formatDate(d),
    };
  }

  function buildDailyWeekChart(txs, currentPage) {
    if (txs.length === 0) return [];

    const weekMap = {};

    txs.forEach((tx) => {
      const monday = getMonday(tx.timestamp);
      const weekKey = dateKey(monday);

      if (!weekMap[weekKey]) {
        weekMap[weekKey] = {
          weekKey,
          monday,
          label: getWeekRange(tx.timestamp).label,
          days: Array.from({ length: 7 }, (_, i) => {
            const d = new Date(monday);
            d.setDate(monday.getDate() + i);

            return {
              key: dateKey(d),
              period: formatDate(d),
              count: 0,
              volume: 0,
            };
          }),
        };
      }

      const txDateKey = dateKey(new Date(tx.timestamp));
      const day = weekMap[weekKey].days.find((x) => x.key === txDateKey);

      if (day) {
        day.count += 1;
        day.volume += Number(tx.value || 0);
      }
    });

    const weeks = Object.values(weekMap).sort((a, b) =>
      a.weekKey.localeCompare(b.weekKey)
    );

    return weeks[currentPage - 1]?.days || [];
  }

  const weeklyDayChart = buildDailyWeekChart(filteredTxs, chartPage);

  const groupedSummaryChart = Object.values(
    filteredTxs.reduce((acc, tx) => {
      const group = getGroupData(tx.timestamp, groupBy);

      acc[group.key] ||= {
        key: group.key,
        period: group.label,
        count: 0,
        volume: 0,
      };

      acc[group.key].count += 1;
      acc[group.key].volume += Number(tx.value || 0);

      return acc;
    }, {})
  ).sort((a, b) => a.key.localeCompare(b.key));

  const dayWeekCount =
    new Set(
      filteredTxs.map((tx) => dateKey(getMonday(tx.timestamp)))
    ).size || 1;

  const CHART_PAGE_SIZE = groupBy === "week" ? 7 : groupedSummaryChart.length;

  const chartTotalPages =
    groupBy === "day"
      ? dayWeekCount
      : Math.ceil(groupedSummaryChart.length / CHART_PAGE_SIZE) || 1;

  const summaryChart =
    groupBy === "day"
      ? weeklyDayChart
      : groupedSummaryChart.slice(
          (chartPage - 1) * CHART_PAGE_SIZE,
          chartPage * CHART_PAGE_SIZE
        );

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <header style={styles.header}>
          <div>
            <p style={styles.kicker}>JFIN Chain Analytics</p>
            <h1 style={styles.title}>USDT Outgoing Dashboard</h1>
            <p style={styles.subtitle}>
              Tracking outgoing USDT transfers from contract address.
            </p>
          </div>

          <button style={styles.refreshButton} onClick={loadData}>
            Refresh
          </button>
        </header>

        <div style={styles.contractBox}>
          <span style={styles.contractLabel}>Contract</span>
          <span style={styles.contractValue}>{CONTRACT}</span>
        </div>

        <div style={styles.cards}>
          <Card title="Balance" value={`${Number(balance).toFixed(4)} JFIN`} />
          <Card title="USDT Outgoing Tx" value={filteredTxs.length} />
          <Card
            title="Volume USDT"
            value={`${totalVolume.toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })} USDT`}
          />
          <Card
          title="Total Fee (JFIN)"
          value={
          filteredTxs
          .reduce((sum, tx) => sum + Number(tx.fee || 0), 0)
          .toFixed(4)
          }
          />
          <Card title="Page Size" value={PAGE_SIZE} />
        </div>

        <Section title="USDT tx Summary">
          <div style={styles.sectionTop}>
            <label style={styles.label}>
              Summary by
              <select
                style={styles.select}
                value={groupBy}
                onChange={(e) => {
                  setGroupBy(e.target.value);
                  setChartPage(1);
                }}
              >
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </label>
          </div>

          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={summaryChart}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="period" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip
                formatter={(value, name) => [
                  name === "count" ? `${value} tx` : value,
                  name,
                ]}
              />
              <Bar dataKey="count" radius={[10, 10, 0, 0]}>
              <LabelList dataKey="count" position="top" />
              </Bar>
              </BarChart>
          </ResponsiveContainer>

          {(groupBy === "day" || groupBy === "week") && (
            <div style={styles.paginationCenter}>
              <Button
                disabled={chartPage === 1}
                onClick={() => setChartPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </Button>

              <span style={styles.pageText}>
                {groupBy === "day" ? "Week Period" : "Period"} {chartPage} /{" "}
                {chartTotalPages}
              </span>

              <Button
                disabled={chartPage >= chartTotalPages}
                onClick={() =>
                  setChartPage((p) => Math.min(chartTotalPages, p + 1))
                }
              >
                Next
              </Button>
            </div>
          )}
        </Section>

        <Section title="USDT Outgoing Transactions">
          {loading ? (
            <p style={styles.muted}>Loading transactions...</p>
          ) : (
            <>
              <p style={styles.muted}>
                Showing {pagedTxs.length} records from {filteredTxs.length} total
              </p>

              <Table
                rows={pagedTxs}
                columns={["no", "time", "hash", "from", "to", "tokenSymbol", "value", "fee"]}
                page={page}
                pageSize={PAGE_SIZE}
              />

              <div style={styles.paginationLeft}>
                <Button
                  disabled={page === 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </Button>

                <span style={styles.pageText}>
                  Page {page} / {totalPages}
                </span>

                <Button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </>
          )}
        </Section>
      </div>
    </div>
  );
}

function Card({ title, value }) {
  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>{title}</div>
      <div style={styles.cardValue}>{value}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section style={styles.section}>
      <h2 style={styles.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}

function Button({ children, disabled, onClick }) {
  return (
    <button
      style={{
        ...styles.button,
        ...(disabled ? styles.buttonDisabled : {}),
      }}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Table({ rows, columns, page, pageSize }) {
  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th style={styles.th} key={c}>
                {c}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row, i) => (
            <tr
              key={`${row.hash}-${i}`}
              style={styles.tr}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#f9fafb";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#ffffff";
              }}
            >
              {columns.map((c) => (
                <td style={styles.td} key={c}>
                  {c === "no" ? (
                  (page - 1) * pageSize + i + 1
                    ) : c === "hash" ? (
  <a
    style={styles.link}
    href={`${EXPLORER}/tx/${row[c]}`}
    target="_blank"
    rel="noreferrer"
  >
    {short(row[c])}
  </a>
                    ) : c === "from" || c === "to" ? (
                   <span style={styles.mono}>{short(row[c])}</span>
                    ) : c === "value" ? (
                    Number(row[c]).toLocaleString(undefined, {
                    maximumFractionDigits: 6,
                    })
                    ) : c === "fee" ? (
                      `${Number(row[c] || 0).toFixed(6)} JFIN`
                    ) : (
                    String(row[c] ?? "-")
                    )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {rows.length === 0 && (
        <p style={styles.empty}>No USDT outgoing transactions found.</p>
      )}
    </div>
  );
}

function short(addr) {
  if (!addr) return "-";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

const styles = {
  page: {
    minHeight: "100vh",
    background:
      "linear-gradient(135deg, #f8fafc 0%, #eef2ff 45%, #f9fafb 100%)",
    fontFamily:
      "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    color: "#111827",
  },
  container: {
    maxWidth: 1320,
    margin: "0 auto",
    padding: "36px 28px",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: 24,
    alignItems: "center",
    marginBottom: 22,
  },
  kicker: {
    margin: 0,
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#6366f1",
  },
  title: {
    margin: "8px 0 6px",
    fontSize: 36,
    lineHeight: 1.1,
    fontWeight: 800,
    color: "#0f172a",
  },
  subtitle: {
    margin: 0,
    fontSize: 15,
    color: "#64748b",
  },
  refreshButton: {
    border: "none",
    borderRadius: 12,
    padding: "11px 18px",
    background: "#111827",
    color: "#ffffff",
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 10px 22px rgba(17, 24, 39, 0.18)",
  },
  contractBox: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
    padding: "14px 16px",
    background: "rgba(255,255,255,0.75)",
    border: "1px solid rgba(226,232,240,0.9)",
    borderRadius: 16,
    marginBottom: 20,
    backdropFilter: "blur(10px)",
  },
  contractLabel: {
    fontSize: 13,
    fontWeight: 700,
    color: "#64748b",
  },
  contractValue: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 13,
    color: "#0f172a",
    wordBreak: "break-all",
  },
  cards: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 18,
    marginBottom: 22,
  },
  card: {
    background: "rgba(255,255,255,0.92)",
    padding: 22,
    borderRadius: 20,
    border: "1px solid rgba(226,232,240,0.9)",
    boxShadow: "0 16px 35px rgba(15, 23, 42, 0.07)",
  },
  cardTitle: {
    color: "#64748b",
    fontSize: 14,
    marginBottom: 10,
    fontWeight: 600,
  },
  cardValue: {
    fontSize: 26,
    lineHeight: 1.2,
    fontWeight: 800,
    color: "#0f172a",
  },
  section: {
    background: "rgba(255,255,255,0.94)",
    padding: 24,
    borderRadius: 22,
    marginBottom: 24,
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.07)",
    border: "1px solid rgba(226,232,240,0.95)",
  },
  sectionTitle: {
    margin: "0 0 18px",
    fontSize: 20,
    fontWeight: 800,
    color: "#0f172a",
  },
  sectionTop: {
    display: "flex",
    justifyContent: "flex-end",
    marginBottom: 12,
  },
  label: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    color: "#475569",
    fontSize: 14,
    fontWeight: 600,
  },
  select: {
    padding: "9px 12px",
    borderRadius: 12,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#0f172a",
    fontWeight: 700,
    outline: "none",
  },
  paginationCenter: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  paginationLeft: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    marginTop: 18,
  },
  button: {
    padding: "9px 15px",
    borderRadius: 12,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#0f172a",
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 6px 14px rgba(15, 23, 42, 0.06)",
  },
  buttonDisabled: {
    opacity: 0.45,
    cursor: "not-allowed",
  },
  pageText: {
    fontSize: 14,
    color: "#475569",
    fontWeight: 700,
  },
  muted: {
    color: "#64748b",
    fontSize: 14,
  },
  tableWrap: {
    overflowX: "auto",
    border: "1px solid #e5e7eb",
    borderRadius: 16,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    background: "#ffffff",
  },
  th: {
    textAlign: "left",
    padding: "14px 16px",
    borderBottom: "1px solid #e5e7eb",
    fontSize: 12,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    background: "#f8fafc",
  },
  tr: {
    transition: "background 0.15s ease",
  },
  td: {
    padding: "14px 16px",
    borderBottom: "1px solid #f1f5f9",
    fontSize: 14,
    color: "#334155",
    whiteSpace: "nowrap",
  },
  mono: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  link: {
    color: "#4f46e5",
    fontWeight: 700,
    textDecoration: "none",
  },
  empty: {
    padding: 18,
    color: "#64748b",
  },
};