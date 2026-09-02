import "./globals.css";

export const metadata = {
  title: "Human Bingo Live",
  description: "Realtime classroom Human Bingo"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
