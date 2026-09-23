"use client";

import { useState, type JSX } from "react";
import { OrderChat } from "@/components/order-chat";
import type { PresentedQuote } from "@/lib/config/quote-types";
import { useDictionary } from "@/lib/i18n/locale-context";
import { QuoteModal } from "./modal-shell";

/**
 * Teklif sohbeti — müşteri ile ekip arasındaki yazışma.
 *
 * Konuşmanın kendisi `<OrderChat>`'tir: bileşen uç adresini (`basePath`) ve
 * hangi odanın olaylarını dinleyeceğini (`orderId`) propla alır, oturumu ve
 * kanal yalıtımını sunucu uygular. Teklif sohbeti tam olarak bu şekle oturur —
 * `quote-chat.ts` canlı olayı `kind:"message"` + `orderId: quoteId` diye
 * yayınlar ve `…/messages/read` ucu sipariş sohbetindekiyle aynı adı taşır.
 * İkinci bir sohbet arayüzü yazmak, mesaj balonlarını ve eklenti yüklemeyi
 * iki yerde bakmak demekti.
 *
 * Sohbet YALNIZ SAHİBİNDİR: paylaşım bağlantısıyla gelen ziyaretçi uçtan 404
 * alır (fiyat pazarlığı iki taraf arasındadır), bu yüzden düğme de çıkmaz.
 *
 * Panel kapalıyken `<OrderChat>` HİÇ bağlanmaz (monte edilmez): yoklaması
 * ancak müşteri sohbeti açtığında başlar.
 */
export function QuoteChatPanel({ quote }: { quote: PresentedQuote }): JSX.Element | null {
  const d = useDictionary();
  const [open, setOpen] = useState(false);

  if (!quote.viewer.isOwner) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-secondary !px-4 !py-2 text-xs"
      >
        {d["instantQuote.chat.title"]}
      </button>

      <QuoteModal
        open={open}
        onClose={() => setOpen(false)}
        title={d["instantQuote.chat.title"]}
        widthClass="max-w-lg"
      >
        <div className="p-4">
          <OrderChat
            basePath={`/api/quotes/${encodeURIComponent(quote.id)}/messages`}
            orderId={quote.id}
          />
        </div>
      </QuoteModal>
    </>
  );
}
