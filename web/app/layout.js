import "./globals.css";

export const metadata = { title: "Deksia Console", description: "Client performance & SMART goals" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
