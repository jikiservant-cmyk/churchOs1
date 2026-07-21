'use client';

import { useEffect, useState } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip as PieTooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as BarTooltip,
  Legend
} from 'recharts';

export function AdminCharts({ 
  genderData, 
  youthData,
  convertsData,
  donationsData,
  attendanceData,
  growthData
}: { 
  genderData: { name: string, value: number, color: string }[],
  youthData?: { name: string, value: number, color: string }[],
  convertsData: { month: string, count: number }[],
  donationsData?: { month: string, amount: number }[],
  attendanceData?: { name: string, count: number }[],
  growthData?: { month: string, count: number }[]
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="space-y-5 mb-5 opacity-0">
        <div className="h-[300px] bg-[#F0E6D3] rounded-2xl animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="h-[250px] bg-[#F0E6D3] rounded-2xl animate-pulse" />
          <div className="h-[250px] bg-[#F0E6D3] rounded-2xl animate-pulse" />
          <div className="h-[250px] bg-[#F0E6D3] rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 mb-5 animate-in fade-in duration-500">
      {/* Attendance History */}
      {attendanceData && (
        <div className="bg-[#F0E6D3] border border-[rgba(90,55,20,0.13)] rounded-2xl p-6 shadow-sm flex flex-col">
          <h4 style={{ fontFamily: "'Playfair Display', serif" }} className="text-lg font-bold text-[#1E1208] mb-4">General Attendance History</h4>
          <div className="flex-1 w-full" style={{ minWidth: 0, minHeight: 300 }}>
            {attendanceData.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center text-[13px] text-[#9A7E65]">No services recorded yet.</div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={attendanceData} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9A7E65', fontWeight: 'bold' }} />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 12, fill: '#9A7E65', fontWeight: 'bold' }} 
                    domain={[0, 'auto']}
                    allowDecimals={false}
                  />
                  <BarTooltip 
                    cursor={{ fill: 'rgba(90,55,20,0.05)' }}
                    contentStyle={{ backgroundColor: '#F0E6D3', border: '1px solid rgba(90,55,20,0.13)', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold' }}
                    formatter={(value: any) => [`${(Number(value) || 0).toLocaleString()} people`, 'Attended']}
                  />
                  <Bar dataKey="count" fill="#B5622A" radius={[4, 4, 0, 0]} maxBarSize={50} name="Attendance" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Gender Distribution */}
        <div className="bg-[#F0E6D3] border border-[rgba(90,55,20,0.13)] rounded-2xl p-6 shadow-sm flex flex-col">
          <h4 style={{ fontFamily: "'Playfair Display', serif" }} className="text-lg font-bold text-[#1E1208] mb-4">Gender</h4>
          <div className="flex-1 w-full" style={{ minWidth: 0, minHeight: 250 }}>
            {genderData.every(d => d.value === 0) ? (
              <div className="h-[250px] flex items-center justify-center text-[13px] text-[#9A7E65]">No gender data available.</div>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={genderData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {genderData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <PieTooltip 
                    contentStyle={{ backgroundColor: '#F0E6D3', border: '1px solid rgba(90,55,20,0.13)', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold' }} 
                    itemStyle={{ color: '#1E1208' }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', fontWeight: 'bold', color: '#9A7E65' }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Youth vs Non-Youth */}
        {(youthData) && (
          <div className="bg-[#F0E6D3] border border-[rgba(90,55,20,0.13)] rounded-2xl p-6 shadow-sm flex flex-col">
            <h4 style={{ fontFamily: "'Playfair Display', serif" }} className="text-lg font-bold text-[#1E1208] mb-4">Demographics</h4>
            <div className="flex-1 w-full" style={{ minWidth: 0, minHeight: 250 }}>
              {youthData.every(d => d.value === 0) ? (
                <div className="h-[250px] flex items-center justify-center text-[13px] text-[#9A7E65]">No demographic data available.</div>
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={youthData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9A7E65', fontWeight: 'bold' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9A7E65', fontWeight: 'bold' }} />
                    <BarTooltip 
                      cursor={{ fill: 'rgba(90,55,20,0.05)' }}
                      contentStyle={{ backgroundColor: '#F0E6D3', border: '1px solid rgba(90,55,20,0.13)', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold' }}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={40} name="Members">
                      {youthData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Growth Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* New Converts Statistics */}
        <div className="bg-[#F0E6D3] border border-[rgba(90,55,20,0.13)] rounded-2xl p-6 shadow-sm flex flex-col">
          <h4 style={{ fontFamily: "'Playfair Display', serif" }} className="text-lg font-bold text-[#1E1208] mb-4">New Converts (Last 6 Months)</h4>
          <div className="flex-1 w-full" style={{ minWidth: 0, minHeight: 250 }}>
            {convertsData.every(d => d.count === 0) ? (
              <div className="h-[250px] flex items-center justify-center text-[13px] text-[#9A7E65]">No new converts over this period.</div>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={convertsData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9A7E65', fontWeight: 'bold' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9A7E65', fontWeight: 'bold' }} />
                  <BarTooltip 
                    cursor={{ fill: 'rgba(90,55,20,0.05)' }}
                    contentStyle={{ backgroundColor: '#F0E6D3', border: '1px solid rgba(90,55,20,0.13)', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold' }}
                  />
                  <Bar dataKey="count" fill="#B5622A" radius={[4, 4, 0, 0]} maxBarSize={40} name="New Converts" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Member Growth Statistics */}
        {growthData && (
          <div className="bg-[#F0E6D3] border border-[rgba(90,55,20,0.13)] rounded-2xl p-6 shadow-sm flex flex-col">
            <h4 style={{ fontFamily: "'Playfair Display', serif" }} className="text-lg font-bold text-[#1E1208] mb-4">Member Growth (Last 6 Months)</h4>
            <div className="flex-1 w-full" style={{ minWidth: 0, minHeight: 250 }}>
              {growthData.every(d => d.count === 0) ? (
                <div className="h-[250px] flex items-center justify-center text-[13px] text-[#9A7E65]">No new members over this period.</div>
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={growthData} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9A7E65', fontWeight: 'bold' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9A7E65', fontWeight: 'bold' }} />
                    <BarTooltip 
                      cursor={{ fill: 'rgba(90,55,20,0.05)' }}
                      contentStyle={{ backgroundColor: '#F0E6D3', border: '1px solid rgba(90,55,20,0.13)', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold' }}
                    />
                    <Line type="monotone" dataKey="count" stroke="#2B1A0E" strokeWidth={3} dot={{ r: 4, fill: '#2B1A0E' }} name="New Members" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Donations Bar Chart */}
      {donationsData && (
        <div className="bg-[#F0E6D3] border border-[rgba(90,55,20,0.13)] rounded-2xl p-6 shadow-sm flex flex-col">
          <h4 style={{ fontFamily: "'Playfair Display', serif" }} className="text-lg font-bold text-[#1E1208] mb-4">Donations (Last 6 Months)</h4>
          <div className="flex-1 w-full" style={{ minWidth: 0, minHeight: 300 }}>
            {donationsData.every(d => d.amount === 0) ? (
              <div className="h-[300px] flex items-center justify-center text-[13px] text-[#9A7E65]">No donation data available for this period.</div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={donationsData} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9A7E65', fontWeight: 'bold' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9A7E65', fontWeight: 'bold' }} tickFormatter={(value) => `/${value}`} />
                  <BarTooltip 
                    cursor={{ fill: 'rgba(90,55,20,0.05)' }}
                    contentStyle={{ backgroundColor: '#F0E6D3', border: '1px solid rgba(90,55,20,0.13)', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold' }}
                    formatter={(value: any) => [`UGX ${(Number(value) || 0).toLocaleString()}`, 'Amount']}
                  />
                  <Bar dataKey="amount" fill="#2B1A0E" radius={[4, 4, 0, 0]} maxBarSize={60} name="Amount" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
