import { prisma } from '@/lib/prisma';
import { formatDistanceToNow, isAfter, isBefore } from 'date-fns'; // npm install date-fns

export default async function HomePage() {
  // 최신 가격 기록과 함께 도서 목록 가져오기
  const books = await prisma.book.findMany({
    include: {
      histories: {
        orderBy: { scraped_at: 'desc' },
        take: 1, // 가장 최근 기록 하나만 가져옴
      },
    },
    orderBy: { updated_at: 'desc' },
  });

  return (
    <main className="p-8 bg-gray-900 text-white min-h-screen">
      <h1 className="text-3xl font-bold mb-6 text-blue-400">RidiDB - Sale Tracker</h1>
      
      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="w-full text-left bg-gray-800">
          <thead>
            <tr className="bg-gray-700 text-gray-300">
              <th className="p-4">Title</th>
              <th className="p-4">Set Price</th>
              <th className="p-4">Discount Period</th>
              <th className="p-4">Recent Sale</th>
              <th className="p-4">All-Time Low</th>
            </tr>
          </thead>
          <tbody>
            {books.map((book) => {
              const lastHistory = book.histories[0];
              const now = new Date();
              
              // 1. 세일 기간 계산
              const startDate = lastHistory?.start_date ? new Date(lastHistory.start_date).toLocaleDateString() : '-';
              const endDate = lastHistory?.end_date ? new Date(lastHistory.end_date).toLocaleDateString() : '-';
              
              // 2. Recent Sale 로직 (Now 또는 기간 표시)
              let saleStatus = "No Data";
              if (lastHistory?.end_date) {
                const end = new Date(lastHistory.end_date);
                saleStatus = isAfter(end, now) 
                  ? "🔥 NOW" 
                  : `${formatDistanceToNow(end, { addSuffix: true })} ago`;
              }

              return (
                <tr key={book.book_id} className="border-t border-gray-700 hover:bg-gray-700 transition">
                  <td className="p-4 font-medium">{book.title}</td>
                  <td className="p-4 text-green-400 font-bold">{book.set_price?.toLocaleString()}원</td>
                  <td className="p-4 text-sm text-gray-400">
                    {startDate} ~ {endDate}
                  </td>
                  <td className="p-4">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${saleStatus === "🔥 NOW" ? 'bg-red-600 animate-pulse' : 'bg-gray-600'}`}>
                      {saleStatus}
                    </span>
                  </td>
                  <td className={`p-4 ${book.set_price === book.all_time_low ? 'text-yellow-400 font-bold' : 'text-blue-300'}`}>
                    {book.all_time_low?.toLocaleString()}원
                    {book.set_price === book.all_time_low && saleStatus === "🔥 NOW" && " ✨"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}